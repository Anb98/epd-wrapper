#!/usr/bin/env python3
"""
Bridge script to control the EPD from TypeScript.
Keeps a live EPD instance and responds to JSON commands via stdin/stdout.
"""

import sys
import os
import json
import base64
import io
import signal  # <-- (Sugerencia) Importado para manejo de señales
import traceback # <-- Importado para mejor logging de errores

from PIL import Image, ImageDraw, ImageFont

# Add the current directory to path for imports
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

# Import original EPD class
try:
    from epd import EPD
except ImportError:
    # Si falla, intenta con import absoluto desde el paquete
    from lib.epd import EPD

class EPDBridge:
    def __init__(self):
        self.epd = None
        self.initialized = False
        self.font_cache = {}  # (font_path, size) -> ImageFont instance
        self._should_stop = False  # Bandera interna para finalizar el loop principal limpiamente
        
        # (Sugerencia) Manejar señales de terminación para limpieza
        signal.signal(signal.SIGTERM, self.shutdown)
        signal.signal(signal.SIGINT, self.shutdown)
        
    def handle_command(self, command):
        """Process commands received from TypeScript"""
        try:
            method = command.get('method')
            params = command.get('params', {})
            
            if method == 'init':
                return self._init()
            # (Sugerencia) Método setPicDir ahora conectado
            elif method == 'setPicDir':
                return self._set_pic_dir(params)
            elif method == 'display':
                return self._display(params)
            elif method == 'displayImage':
                return self._display_image(params)
            elif method == 'clear':
                return self._clear(params)
            elif method == 'sleep':
                return self._sleep()
            elif method == 'getInfo':
                return self._get_info()
            elif method == 'drawShapes':
                return self._draw_shapes(params)
            elif method == 'drawText':
                return self._draw_text(params)
            else:
                return {'success': False, 'error': f'Unknown method: {method}'}
                
        except Exception as e:
            return {
                'success': False, 
                'error': str(e),
                'traceback': traceback.format_exc()
            }
    
    def _set_pic_dir(self, params):
        """Configure resource directory (fonts, images)"""
        picdir = params.get('picdir')
        if picdir and os.path.isdir(picdir):
            self.picdir = os.path.abspath(picdir)
            return {'success': True, 'data': {'picdir': self.picdir}}
        else:
            return {'success': False, 'error': f'Invalid picdir: {picdir}'}
    
    def _init(self):
        """Initialize the EPD display"""
        if self.epd is None:
            # Set by EPDWrapper at spawn time from its `rotate` option
            self.epd = EPD(rotate=int(os.environ.get('EPD_WRAPPER_ROTATE', '0')))
        
        result = self.epd.init()
        if result == 0:
            self.initialized = True
            return {
                'success': True,
                'data': {
                    'width': self.epd.width,
                    'height': self.epd.height
                }
            }
        else:
            return {'success': False, 'error': 'Failed to initialize EPD'}
    
    def _display_image(self, params):
        """Display an image from file or base64 buffer"""
        if not self.initialized:
            return {'success': False, 'error': 'EPD not initialized'}
        
        image_data = params.get('image')
        image_path = params.get('path')
        
        try:
            if image_path:
                if not os.path.exists(image_path):
                    return {'success': False, 'error': f'Image file not found: {image_path}'}
                image = Image.open(image_path)
            elif image_data:
                image_bytes = base64.b64decode(image_data)
                image = Image.open(io.BytesIO(image_bytes))
            else:
                return {'success': False, 'error': 'No image data or path provided'}
            
            buffer = self.epd.getbuffer(image)
            self.epd.display(buffer)
            
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': f'Display error: {str(e)}', 'traceback': traceback.format_exc()}
    
    def _display(self, params):
        """Display a blank RGB buffer (for custom drawing base)"""
        # Note: This method creates a blank image rather than using an external buffer.
        if not self.initialized:
            return {'success': False, 'error': 'EPD not initialized'}
        
        try:
            width = params.get('width', self.epd.width)
            height = params.get('height', self.epd.height)
            bg_color = params.get('bgColor', 'white')
            
            image = Image.new('RGB', (width, height), bg_color)
            
            buffer = self.epd.getbuffer(image)
            self.epd.display(buffer)
            
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': f'Display error: {str(e)}', 'traceback': traceback.format_exc()}
    
    def _draw_text(self, params):
        """Draw text items on the display"""
        if not self.initialized:
            return {'success': False, 'error': 'EPD not initialized'}
        
        try:
            text_items = params.get('items', [])
            bg_color = params.get('bgColor', 'white')
            
            image = Image.new('RGB', (self.epd.width, self.epd.height), 
                              getattr(self.epd, bg_color.upper(), self.epd.WHITE))
            draw = ImageDraw.Draw(image)
            
            for item in text_items:
                text = item.get('text', '')
                x = item.get('x', 0)
                y = item.get('y', 0)
                font_size = item.get('fontSize', 24)
                color = item.get('color', 'BLACK')
                font_path = item.get('fontPath')
                
                font = None
                if font_path and os.path.exists(font_path):
                    key = (font_path, font_size)
                    font = self.font_cache.get(key)
                    if font is None:
                        try:
                            font = ImageFont.truetype(font_path, font_size)
                            self.font_cache[key] = font
                        except Exception as e:
                            print(f"Warning: Could not load font {font_path}: {e}", file=sys.stderr)
                if font is None:
                    # Default font (dynamic sizing unsupported here)
                    font = ImageFont.load_default()
                
                fill_color = getattr(self.epd, color.upper(), self.epd.BLACK)
                draw.text((x, y), text, font=font, fill=fill_color)
            
            buffer = self.epd.getbuffer(image)
            self.epd.display(buffer)
            
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': f'Draw text error: {str(e)}', 'traceback': traceback.format_exc()}
    
    def _draw_shapes(self, params):
        """Draw geometric shapes on the display"""
        if not self.initialized:
            return {'success': False, 'error': 'EPD not initialized'}
        
        try:
            shapes = params.get('shapes', [])
            bg_color = params.get('bgColor', 'white')
            
            image = Image.new('RGB', (self.epd.width, self.epd.height), 
                              getattr(self.epd, bg_color.upper(), self.epd.WHITE))
            draw = ImageDraw.Draw(image)
            
            for shape in shapes:
                shape_type = shape.get('type')
                color = getattr(self.epd, shape.get('color', 'BLACK').upper(), self.epd.BLACK)
                
                if shape_type == 'line':
                    coords = shape.get('coords', [])
                    draw.line(coords, fill=color, width=shape.get('width', 1)) # Optional width
                
                elif shape_type == 'rectangle':
                    coords = shape.get('coords', [])
                    outline = getattr(self.epd, shape.get('outline', 'BLACK').upper(), self.epd.BLACK)
                    fill = getattr(self.epd, shape.get('fill', 'WHITE').upper(), None) if shape.get('fill') else None
                    draw.rectangle(coords, outline=outline, fill=fill)
                
                elif shape_type == 'arc':
                    coords = shape.get('coords', [])
                    start = shape.get('start', 0)
                    end = shape.get('end', 360)
                    draw.arc(coords, start, end, fill=color)
                
                elif shape_type == 'chord':
                    coords = shape.get('coords', [])
                    start = shape.get('start', 0)
                    end = shape.get('end', 360)
                    draw.chord(coords, start, end, fill=color)
            
            buffer = self.epd.getbuffer(image)
            self.epd.display(buffer)
            
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': f'Draw shapes error: {str(e)}', 'traceback': traceback.format_exc()}
    
    def _clear(self, params):
        """Clear the display"""
        if not self.initialized:
            return {'success': False, 'error': 'EPD not initialized'}
        
        color = params.get('color', 0x11)
        self.epd.Clear(color)
        return {'success': True}
    
    def _sleep(self):
        """Put the display into sleep mode and cleanup state"""
        if not self.initialized:
            return {'success': False, 'error': 'EPD not initialized'}
        
        self.epd.sleep()
        self.initialized = False
        return {'success': True}
    
    def _get_info(self):
        """Return display information"""
        if self.epd is None:
            # Inicializa temporalmente solo para obtener ancho/alto si aún no existe
            temp_epd = EPD()
            width = temp_epd.width
            height = temp_epd.height
            colors = {
                'BLACK': temp_epd.BLACK,
                'WHITE': temp_epd.WHITE,
                'YELLOW': temp_epd.YELLOW,
                'RED': temp_epd.RED,
                'BLUE': temp_epd.BLUE,
                'GREEN': temp_epd.GREEN
            }
        else:
            width = self.epd.width
            height = self.epd.height
            colors = {
                'BLACK': self.epd.BLACK,
                'WHITE': self.epd.WHITE,
                'YELLOW': self.epd.YELLOW,
                'RED': self.epd.RED,
                'BLUE': self.epd.BLUE,
                'GREEN': self.epd.GREEN
            }

        return {
            'success': True,
            'data': {
                'width': width,
                'height': height,
                'colors': colors,
                'initialized': self.initialized
            }
        }
    
    def shutdown(self, signum=None, frame=None):
        """
        Handle graceful shutdown.
        Puts the EPD to sleep and marks internal stop flag.
        """
        print("Shutting down bridge...", file=sys.stderr)
        if self.epd and self.initialized:
            try:
                print("Putting EPD to sleep...", file=sys.stderr)
                self.epd.sleep()
                self.initialized = False
                print("EPD sleep successful.", file=sys.stderr)
            except Exception as e:
                print(f"Error during EPD sleep on shutdown: {e}", file=sys.stderr)
        # Señala que debe detenerse el bucle principal
        self._should_stop = True

    def run(self):
        """Main loop listening for commands from stdin (robust and cancellable)"""
        self._send_response({'ready': True})

        try:
            for raw_line in sys.stdin:
                if self._should_stop:
                    break

                line = raw_line.strip()
                if not line:
                    continue

                # Defensive size limit (2MB per line)
                if len(line) > 2_000_000:
                    self._send_response({
                        'success': False,
                        'error': 'Line too long',
                        'id': None
                    })
                    continue

                command_id = None
                try:
                    command = json.loads(line)
                    command_id = command.get('id')
                    method = command.get('method')

                    # Comando explícito de salida
                    if method in ('shutdown', 'exit'):
                        self._send_response({'success': True, 'id': command_id, 'exiting': True})
                        self.shutdown()
                        break

                    response_data = self.handle_command(command)
                    response_data['id'] = command_id
                    self._send_response(response_data)

                except json.JSONDecodeError as e:
                    self._send_response({
                        'success': False,
                        'error': f'Invalid JSON: {e}',
                        'id': None
                    })
                except Exception as e:
                    self._send_response({
                        'success': False,
                        'error': str(e),
                        'traceback': traceback.format_exc(),
                        'id': command_id
                    })
        except KeyboardInterrupt:
            print("KeyboardInterrupt received.", file=sys.stderr)
        finally:
            # Limpieza final (sin abortar el proceso con sys.exit)
            if self.epd and self.initialized:
                try:
                    self.epd.sleep()
                    self.initialized = False
                except Exception as e:
                    print(f"Error putting EPD to sleep: {e}", file=sys.stderr)

    def _send_response(self, response):
        """Envía respuesta como JSON a stdout"""
        try:
            print(json.dumps(response), flush=True)
        except TypeError as e:
            # Error común si 'response' no es serializable
            # (Corrección) Intenta preservar el ID incluso en error de serialización
            error_response = {
                'success': False,
                'error': f'Failed to serialize response: {str(e)}',
                'id': response.get('id') 
            }
            print(json.dumps(error_response), flush=True)

if __name__ == '__main__':
    bridge = EPDBridge()
    bridge.run()
