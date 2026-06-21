from flask import Flask, send_from_directory, request, jsonify
from flask_sock import Sock
from flask_cors import CORS
import json

app = Flask(__name__, static_folder='data', static_url_path='')
CORS(app)
sock = Sock(app)

# Data sensor
sensor_data = {
    "gyro":      {"gyroX": "0", "gyroY": "0", "gyroZ": "0"},
    "acc":       {"accX":  "0", "accY":  "0", "accZ":  "0"},
    "temp":      "0",
    "warning":   False,
    "recording": True  # selalu active karena ESP32 selalu kirim
}

# Threshold hardcode 
current_threshold = 1.0

# Browser clients
browser_clients = set()

# Flag kontrol ke ESP32
control_flags = {
    "resetX":    False,
    "resetY":    False,
    "resetZ":    False,
    "calibrate": False
}

# ── Halaman utama ──────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('data', 'index.html')

# ── WebSocket: ESP32 → Flask ───────────────────────────────
@sock.route('/ws-esp32')
def ws_esp32(ws):
    print("✅ ESP32 terhubung!")
    while True:
        try:
            raw = ws.receive(timeout=10)  # timeout 10 detik
            if raw is None:
                break

            data = json.loads(raw)

            if 'gyroX' in data:
                sensor_data['gyro'] = {
                    "gyroX": data.get('gyroX', '0'),
                    "gyroY": data.get('gyroY', '0'),
                    "gyroZ": data.get('gyroZ', '0')
                }
            if 'accX' in data:
                sensor_data['acc'] = {
                    "accX": data.get('accX', '0'),
                    "accY": data.get('accY', '0'),
                    "accZ": data.get('accZ', '0')
                }
            if 'temperature' in data:
                sensor_data['temp']    = data.get('temperature', '0')
            if 'warning' in data:
                sensor_data['warning'] = data.get('warning', False)

            # Kirim balik flag kontrol ke ESP32
            response = {
                "resetX":    control_flags["resetX"],
                "resetY":    control_flags["resetY"],
                "resetZ":    control_flags["resetZ"],
                "calibrate": control_flags["calibrate"],
                "threshold": current_threshold
            }
            # Reset flag setelah dikirim
            control_flags["resetX"]    = False
            control_flags["resetY"]    = False
            control_flags["resetZ"]    = False
            control_flags["calibrate"] = False
            ws.send(json.dumps(response))

            # Broadcast ke semua browser
            dead = set()
            for client in browser_clients:
                try:
                    client.send(json.dumps(sensor_data))
                except:
                    dead.add(client)
            browser_clients.difference_update(dead)

        except Exception as e:
            print(f"❌ ESP32 error: {e}")
            break

    print("ESP32 disconnected.")

# ── WebSocket: Flask → Browser ─────────────────────────────
@sock.route('/ws-browser')
def ws_browser(ws):
    print("🌐 Browser terhubung!")
    browser_clients.add(ws)
    try:
        while True:
            msg = ws.receive(timeout=30)
            if msg is None:
                break
    except:
        pass
    finally:
        browser_clients.discard(ws)
        print("Browser disconnected.")

# ── HTTP GET: Kalibrasi ────────────────────────────────────
@app.route('/calibrate', methods=['GET'])
def calibrate():
    control_flags["calibrate"] = True
    control_flags["resetX"]    = True
    control_flags["resetY"]    = True
    control_flags["resetZ"]    = True
    print("🔄 Kalibrasi dipicu dari web")
    return jsonify({"status": "calibrating"}), 200

# ── HTTP GET: Reset posisi ─────────────────────────────────
@app.route('/reset', methods=['GET'])
def reset_all():
    control_flags["resetX"] = True
    control_flags["resetY"] = True
    control_flags["resetZ"] = True
    return jsonify({"status": "reset all"}), 200

@app.route('/resetX', methods=['GET'])
def reset_x():
    control_flags["resetX"] = True
    return jsonify({"status": "reset X"}), 200

@app.route('/resetY', methods=['GET'])
def reset_y():
    control_flags["resetY"] = True
    return jsonify({"status": "reset Y"}), 200

@app.route('/resetZ', methods=['GET'])
def reset_z():
    control_flags["resetZ"] = True
    return jsonify({"status": "reset Z"}), 200

# ── HTTP POST: Set threshold (dari program/hardcode) ───────
@app.route('/threshold', methods=['POST'])
def set_threshold():
    global current_threshold
    data = request.get_json()
    current_threshold = float(data.get('threshold', 1.0))
    print(f"⚙️ Threshold diubah ke: {current_threshold}")
    return jsonify({"status": "ok", "threshold": current_threshold}), 200

# ── HTTP GET: Cek status sistem ────────────────────────────
@app.route('/status', methods=['GET'])
def get_status():
    return jsonify({
        "esp32_clients":   len(browser_clients),
        "threshold":       current_threshold,
        "warning":         sensor_data['warning'],
        "last_temp":       sensor_data['temp']
    }), 200

# ── Jalankan ───────────────────────────────────────────────
if __name__ == '__main__':
    print("🚀 Flask server: http://0.0.0.0:5000")
    app.run(host='0.0.0.0', port=5000, debug=False)