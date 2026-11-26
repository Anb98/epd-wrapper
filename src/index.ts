import { spawn, ChildProcess } from "child_process";
import { join, dirname } from "path";
// Lazy load sharp to reduce initial memory footprint
let sharpModule: typeof import("sharp") | null = null;
function getSharp(): typeof import("sharp") {
  if (!sharpModule) {
    // Deferred loading only when image manipulation is needed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sharpModule = require("sharp") as typeof import("sharp");
  }
  return sharpModule; // Guaranteed initialized above
}

interface EPDColors {
  BLACK: number;
  WHITE: number;
  YELLOW: number;
  RED: number;
  BLUE: number;
  GREEN: number;
}

interface EPDInfo {
  width: number;
  height: number;
  colors: EPDColors;
  initialized: boolean;
}

export class EPDWrapper {
  private pythonProcess: ChildProcess | null = null;
  private commandQueue: Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  > = new Map();
  private commandId = 0;
  private ready = false;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private errorBuffer: string = ""; // Accumulated stderr output buffer
  private readonly errorBufferMax = 8192; // Maximum retained stderr buffer size
  private _stopping = false;
  private LOG_ENABLED: boolean;
  private DEBUG_ENABLED: boolean;
  private ROTATE: number;
  private log(...args: unknown[]) {
    if (this.LOG_ENABLED) console.log(...args);
  }
  private warn(...args: unknown[]) {
    if (this.LOG_ENABLED) console.warn(...args);
  }
  private debug(...args: unknown[]) {
    if (this.DEBUG_ENABLED) console.debug(...args);
  }
  private formatErr(e: unknown): string {
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }

  constructor(
    private pythonPath: string = "python3",
    private bridgeScript: string = join(
      __dirname,
      "..",
      "lib",
      "epd_bridge.py"
    ),
    options: {
      log?: boolean;
      debug?: boolean;
      /** Turns every image after it is fitted to the panel: 0 (default) or 180. Other values throw. */
      rotate?: number;
    } = {}
  ) {
    this.LOG_ENABLED = options.log !== undefined ? options.log : true;
    this.DEBUG_ENABLED = !!options.debug;
    const rotate = options.rotate ?? 0;
    if (rotate !== 0 && rotate !== 180) {
      throw new Error(
        `Invalid rotate option: ${rotate}. Allowed values: 0, 180.`
      );
    }
    this.ROTATE = rotate;
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  /**
   * Starts the Python bridge process.
   */
  async start(): Promise<void> {
    if (this.pythonProcess) {
      throw new Error("EPD bridge already started");
    }

    this.log("[EPD] Starting Python bridge...");

    return new Promise((resolve, reject) => {
      // Get the directory of the bridge script
      const scriptDir = dirname(this.bridgeScript);

      // Run Python unbuffered (-u) and append the directory to PYTHONPATH
      this.pythonProcess = spawn(this.pythonPath, ["-u", this.bridgeScript], {
        env: {
          ...process.env,
          // Ensure Python can locate the 'epd' library
          PYTHONPATH:
            scriptDir +
            (process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ""),
          PYTHONUNBUFFERED: "1",
          // Read by epd_bridge.py and applied in EPD.getbuffer
          EPD_WRAPPER_ROTATE: String(this.ROTATE),
        },
        // Execute the script from its own directory
        cwd: scriptDir,
      });

      let buffer = "";

      this.pythonProcess.stdout?.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");

        // Process all complete lines
        for (let i = 0; i < lines.length - 1; i++) {
          this.handleResponse(lines[i]);
        }

        // Keep the last incomplete line in the buffer
        buffer = lines[lines.length - 1];
      });

      this.pythonProcess.stderr?.on("data", (data) => {
        const errorMsg = data.toString();
        this.errorBuffer += errorMsg; // Accumulate stderr chunk
        this.warn(`EPD Python Error: ${errorMsg}`);
        // Enforce buffer limit to avoid unbounded memory growth
        if (this.errorBuffer.length > this.errorBufferMax) {
          this.errorBuffer = this.errorBuffer.slice(-this.errorBufferMax);
        }
      });

      this.pythonProcess.on("error", (error) => {
        this.log(`[EPD] Failed to start Python process: ${error.message}`);
        reject(new Error(`Failed to start Python process: ${error.message}`));
      });

      this.pythonProcess.on("close", (code) => {
        this.log(`EPD bridge process exited with code ${code}`);
        this.pythonProcess = null;
        this.ready = false;
        // If the bridge closes unexpectedly, reject pending promises
        if (code !== 0) {
          const exitError = new Error(
            `Python bridge exited unexpectedly with code ${code}. Stderr: ${this.errorBuffer}`
          );
          this.commandQueue.forEach((pending) => pending.reject(exitError));
          this.commandQueue.clear();
          // If 'start' was still pending, reject it
          if (!this.ready) {
            reject(exitError);
          }
        } else if (this._stopping) {
          const stopError = new Error("EPD bridge stopped");
          this.commandQueue.forEach((pending) => pending.reject(stopError));
          this.commandQueue.clear();
        }
      });

      // Wait until the bridge signals readiness
      this.readyPromise
        .then(() => {
          this.ready = true;
          this.errorBuffer = ""; // Clear error buffer if startup succeeded
          this.log("[EPD] Bridge started and ready.");

          resolve();
        })
        .catch(reject); // Propagate errors if 'readyPromise' is rejected
    });
  }

  /**
   * Stops the Python process safely.
   */
  async stop(): Promise<void> {
    this.log("[EPD] Stopping bridge...");
    if (this.pythonProcess) {
      // Attempt to put the display to sleep first
      if (this.ready) {
        try {
          await this.sleep();
        } catch (error) {
          this.warn(
            `Failed to put EPD to sleep before stopping: ${this.formatErr(
              error
            )}`
          );
        }
      }

      this._stopping = true;
      this.pythonProcess.kill(); // SIGTERM
      this.pythonProcess = null;
      this.ready = false;
      this.log("[EPD] Bridge stopped.");
    } else {
      this.log("[EPD] Bridge was already stopped.");
    }
  }

  /**
   * Handles responses received from the Python process.
   */
  private handleResponse(line: string): void {
    if (!line.trim()) {
      return; // Ignore empty lines
    }

    try {
      const response = JSON.parse(line);

      // "ready" message
      if (response.ready) {
        this.readyResolve();
        this.log('[EPD] Received "ready" signal from Python.');

        return;
      }

      // Response to a command with ID
      if (response.id !== undefined) {
        const pending = this.commandQueue.get(response.id);
        if (pending) {
          this.commandQueue.delete(response.id);
          if (response.success) {
            pending.resolve(response.data);
          } else {
            // Reconstruct a more complete error
            const errorMsg = response.error || "Unknown Python error";
            const trace = response.traceback
              ? `\n--- Python Traceback ---\n${response.traceback}`
              : "";
            pending.reject(new Error(errorMsg + trace));
          }
        }
      } else {
        // Python message without ID (e.g., print() or warning)
        this.debug(`EPD Python Log: ${line}`);
      }
    } catch (err) {
      this.warn("Failed to parse response:", line, this.formatErr(err));
    }
  }

  /**
   * Sends a command to the Python process.
   */
  private async sendCommand(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    if (!this.ready || !this.pythonProcess) {
      this.warn(
        `[EPD] FAILED command '${method}': Bridge not ready or already stopped.`
      );
      throw new Error("EPD bridge not ready or already stopped");
    }
    // Verify stdin is writable
    if (!this.pythonProcess.stdin || !this.pythonProcess.stdin.writable) {
      this.warn(
        `[EPD] FAILED command '${method}': Python process stdin is not writable.`
      );
      throw new Error("Python process stdin is not writable");
    }

    this.debug(`[EPD] > Sending command: ${method}`);

    const id = this.commandId++;
    const command = { id, method, params };

    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.commandQueue.delete(id);
        reject(new Error(`Command timeout: ${method}`));
      }, 30000);

      this.commandQueue.set(id, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      try {
        this.pythonProcess!.stdin?.write(JSON.stringify(command) + "\n");
      } catch (error) {
        this.commandQueue.delete(id);
        clearTimeout(timeout);
        reject(new Error(`Failed to write to Python stdin: ${error}`));
      }
    });

    // --- RESULT LOGS ---
    try {
      const result = await promise;
      this.debug(`[EPD] > Command succeeded: ${method}`);
      return result;
    } catch (error) {
      this.warn(`[EPD] < Command FAILED: ${method}`);
      throw error; // Re-throw for caller handling
    }
  }

  /**
   * Initializes the EPD display.
   */
  async init(): Promise<{ width: number; height: number }> {
    return this.sendCommand("init") as Promise<{
      width: number;
      height: number;
    }>;
  }

  /**
   * Displays an image on the screen from a file path.
   * @param imagePath Absolute or relative path to the image file
   */
  async displayImage(imagePath: string): Promise<void> {
    // Convert to absolute path if relative
    const absolutePath = imagePath.startsWith("/")
      ? imagePath
      : join(process.cwd(), imagePath);

    await this.sendCommand("displayImage", { path: absolutePath });
  }

  /**
   * Displays an image buffer directly.
   * @param imageBuffer Raw image buffer
   */
  async displayBuffer(imageBuffer: Buffer): Promise<void> {
    const base64Image = imageBuffer.toString("base64");

    // Must call 'displayImage' which in Python handles base64 input.
    await this.sendCommand("displayImage", { image: base64Image });
  }

  /**
   * Creates and displays a blank (background) image.
   * @param width Image width
   * @param height Image height
   * @param color Background color
   */
  async displayCustom(
    width: number,
    height: number,
    color: { r: number; g: number; b: number } = { r: 255, g: 255, b: 255 }
  ): Promise<void> {
    // Create a blank image
    const sharpFn = getSharp();
    const image = await sharpFn({
      create: {
        width,
        height,
        channels: 3,
        background: color,
      },
    })
      .png()
      .toBuffer();

    await this.displayBuffer(image);
  }

  /**
   * Draws multiple text items on the display (similar to original Python example).
   * @param textItems Array of text objects with position, size, color, etc.
   * @param bgColor Background color (BLACK, WHITE, YELLOW, RED, BLUE, GREEN)
   */
  async drawText(
    textItems: Array<{
      text: string;
      x: number;
      y: number;
      fontSize?: number;
      color?: string;
      fontPath?: string; // Ruta absoluta o relativa al archivo de fuente (.ttf, .ttc)
    }>,
    bgColor: string = "white"
  ): Promise<void> {
    // Convert font paths to absolute paths
    const itemsWithAbsolutePaths = textItems.map((item) => {
      if (item.fontPath && !item.fontPath.startsWith("/")) {
        return {
          ...item,
          fontPath: join(process.cwd(), item.fontPath),
        };
      }
      return item;
    });

    await this.sendCommand("drawText", {
      items: itemsWithAbsolutePaths,
      bgColor,
    });
  }

  /**
   * Draws geometric shapes (lines, rectangles, arcs, etc.).
   * @param shapes Array of shapes to draw
   * @param bgColor Background color
   */
  async drawShapes(
    shapes: Array<{
      type: "line" | "rectangle" | "arc" | "chord";
      coords: number[];
      color?: string;
      outline?: string;
      fill?: string;
      start?: number;
      end?: number;
      width?: number; // Suggested: custom line width
    }>,
    bgColor: string = "white"
  ): Promise<void> {
    await this.sendCommand("drawShapes", {
      shapes,
      bgColor,
    });
  }

  /**
   * Sets the resources directory (fonts, images) on the Python side.
   * @param picdir Path to resources directory
   */
  async setPicDir(picdir: string): Promise<string> {
    const absolutePath = picdir.startsWith("/")
      ? picdir
      : join(process.cwd(), picdir);

    const result = (await this.sendCommand("setPicDir", {
      picdir: absolutePath,
    })) as { picdir: string };
    return result.picdir;
  }

  /**
   * Clears the display with a solid color.
   * @param color Hex color (default 0x11)
   */
  async clear(color: number = 0x11): Promise<void> {
    await this.sendCommand("clear", { color });
  }

  /**
   * Puts the display into sleep mode.
   */
  async sleep(): Promise<void> {
    await this.sendCommand("sleep");
  }

  /**
   * Retrieves display information.
   */
  async getInfo(): Promise<EPDInfo> {
    return this.sendCommand("getInfo") as Promise<EPDInfo>;
  }

  /**
   * Returns whether the bridge is ready.
   */
  isReady(): boolean {
    return this.ready;
  }
}
