# Waveshare 4-Inch E-Paper HAT+ (E) Wrapper for Raspberry Pi

A simple TypeScript/JavaScript wrapper for the [Waveshare 4-Inch E-Paper HAT+ (E)](https://www.waveshare.com/4inch-e-paper-hat-plus-e.htm?sku=27366), designed specifically for use with Raspberry Pi. This package acts as a bridge to the underlying Python drivers, allowing you to control the 6-color e-paper display from your Node.js projects.

## Features

-   Display images from a file path or a raw Buffer.
-   Clear the display.
-   Put the display into a low-power sleep mode.
-   Advanced drawing functions for text and shapes.
-   Simple, promise-based async API running over a persistent Python bridge.

---

## 1. Prerequisites

This package communicates with the hardware via Python scripts. Therefore, you must configure your Raspberry Pi correctly and install the required system and Python libraries before using this npm package.

### Hardware Requirements

-   Any model of Raspberry Pi.
-   [Waveshare 4-Inch E-Paper HAT+ (E)](https://www.waveshare.com/4inch-e-paper-hat-plus-e.htm?sku=27366) correctly attached to the Raspberry Pi's GPIO headers.

### Raspberry Pi Configuration

Follow the official manufacturer's guide here: [Working With Raspberry Pi](https://www.waveshare.com/wiki/4inch_e-Paper_HAT%2B_(E)_Manual#Working_With_Raspberry_Pi).

The two most important steps are enabling the SPI interface and installing the necessary Python libraries.

#### **A. Enable SPI Interface**

The display communicates with the Raspberry Pi via the SPI interface, which is disabled by default.

1.  Open a terminal on your Raspberry Pi.
2.  Run the configuration tool:
    ```bash
    sudo raspi-config
    ```
3.  Navigate to `Interface Options` -> `SPI`.
4.  Select `<Yes>` to enable the SPI interface.
5.  Reboot your Raspberry Pi when prompted.

#### **B. Install Python Libraries**

This wrapper depends on the official Python drivers from Waveshare, which require `Pillow`, `NumPy`, and `spidev`.

Run the following commands in your terminal to install these dependencies:

```bash
# Update package lists
sudo apt-get update

# Install Python 3 pip and required imaging/math libraries
sudo apt-get install python3-pip
sudo apt-get install python3-pil
sudo apt-get install python3-numpy

# Install the Python SPI development library
sudo pip3 install spidev
```

---

## 2. Installation

Once the prerequisites are met, you can install this package into your Node.js project.

```bash
npm install epd-wrapper
```

---

## 3. Usage

The following example demonstrates the proper lifecycle: starting the bridge, initializing the display, fetching an image from a URL, displaying it, and safely stopping the bridge.

**Important:** The display's resolution is **640x400 pixels**. Ensure the image you use matches this size.

```typescript
// example.ts
import { EPDWrapper } from 'epd-wrapper';

// A direct link to a 640x400 image
const imageUrl = 'https://picsum.photos/640/400';

async function main() {
  const epd = new EPDWrapper();

  // Use a try...finally block to ensure the bridge is always stopped
  try {
    console.log('Starting Python bridge...');
    await epd.start();
    console.log('Bridge started.');

    console.log('Initializing display...');
    const info = await epd.init();
    console.log('Display initialized:', info); // { width: 640, height: 400 }

    console.log(`Fetching image from ${imageUrl}...`);
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    console.log('Image downloaded successfully.');

    console.log('Displaying image from buffer...');
    await epd.displayBuffer(imageBuffer);
    console.log('Image displayed successfully.');

    // Wait for 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log('Clearing display...');
    await epd.clear();
    console.log('Display cleared.');

    console.log('Putting display to sleep...');
    await epd.sleep();
    console.log('Display is now in low-power mode.');

  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    if (epd.isReady()) {
      console.log('Stopping Python bridge...');
      await epd.stop();
      console.log('Bridge stopped.');
    }
  }
}

main();
```

---

## 4. Display Update Cycle and Recommendations

To ensure the longevity of the e-paper display and manage power correctly, follow this recommended workflow:

1.  **Initial Display:**
    -   `await epd.start()`
    -   `await epd.init()`
    -   `await epd.displayBuffer(...)` or `displayImage(...)`

2.  **Entering Low-Power Mode:**
    -   After the image is displayed and no further updates are immediately needed, put the display to sleep to save power.
    -   `await epd.sleep()`

3.  **Waking Up and Displaying a New Image:**
    -   To display a new image after the device has been put to sleep, you must **re-initialize the hardware by calling `init()` again**.
    -   `await epd.init()`
    -   You can then immediately display the new image: `await epd.displayBuffer(...)`
    -   **Note:** It is **not** necessary to call `clear()` before displaying a new image, as the new image will completely overwrite the previous one.

---

## 5. API Reference

### `new EPDWrapper(pythonPath?, bridgeScript?, options?)`

Creates a new instance of the E-Paper Display controller. All arguments are optional.

-   `pythonPath`: Path to the python executable (defaults to `python3`).
-   `bridgeScript`: Path to the `epd_bridge.py` script.
-   `options`: `{ log?: boolean; debug?: boolean; }` to control console output.

### `async epd.start(): Promise<void>`

Starts the Python bridge process. This must be called before any other methods.

### `async epd.init(): Promise<{ width: number; height: number }>`

Initializes the e-paper hardware. Must be called after `start()` or to wake the display from sleep. Returns the display dimensions.

### `async epd.displayImage(imagePath: string): Promise<void>`

Displays an image on the screen from a file path. The image should be 640x400.

### `async epd.displayBuffer(imageBuffer: Buffer): Promise<void>`

Displays an image from a raw image buffer. The image should be 640x400.

### `async epd.clear(): Promise<void>`

Clears the display, setting it to a blank (white) state.

### `async epd.sleep(): Promise<void>`

Puts the display into a low-power consumption mode. It's recommended to call this when updates are complete.

### `async epd.stop(): Promise<void>`

Safely shuts down the Python bridge process. It's crucial to call this to clean up resources. It will attempt to put the display to sleep first.

### Advanced Drawing

The wrapper also supports more advanced drawing functions like `drawText(...)` and `drawShapes(...)`. Please refer to the source code in `src/index.ts` for their signatures and usage.

---

## 6. Additional Resources

-   [Waveshare e-Paper GitHub Repository](https://github.com/waveshareteam/e-Paper): Contains original drivers, examples, and more detailed information from the manufacturer.

---

## How It Works

This library is a lightweight wrapper that spawns and manages a persistent Python child process (`epd_bridge.py`). Commands are sent from Node.js to the Python process via `stdin`, and responses are received via `stdout`. This avoids the overhead of starting a new Python process for every command.

## License

This project is licensed under the ISC License.
