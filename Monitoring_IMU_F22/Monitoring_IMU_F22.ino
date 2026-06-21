#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoWebsockets.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Arduino_JSON.h>

using namespace websockets;

// ── Konfigurasi ───────────────────────────────────────────
const char* ssid     = "dewa24";
const char* password = "siuuuuuu";
const char* wsServer = "ws:// 10.137.177.92:5000/ws-esp32";

#define BUZZER_PIN  26   // GPIO 26
#define LED_PIN     27   // GPIO 27 → Resistor 220Ω → LED

float THRESHOLD = 1.0;

// ── WebSocket ─────────────────────────────────────────────
WebsocketsClient wsClient;
bool wsConnected = false;

// ── Timer ─────────────────────────────────────────────────
unsigned long lastGyro   = 0;
unsigned long lastAcc    = 0;
unsigned long lastTemp   = 0;
unsigned long lastSend   = 0;
unsigned long lastReconn = 0;
unsigned long lastLed    = 0;  // timer kedap-kedip LED
bool ledState = false;

// ── Sensor ────────────────────────────────────────────────
Adafruit_MPU6050 mpu;
sensors_event_t a, g, temp;

float gyroX = 0, gyroY = 0, gyroZ = 0;
float accX, accY, accZ;
float temperature;

float gyroXoffset = 0, gyroYoffset = 0, gyroZoffset = 0;
float gyroXerror  = 0.07, gyroYerror = 0.03, gyroZerror = 0.01;

// ── Kalibrasi ─────────────────────────────────────────────
void calibrateMPU() {
  Serial.println("Kalibrasi...");

  // Buzzer + LED tanda mulai
  digitalWrite(BUZZER_PIN, HIGH);
  digitalWrite(LED_PIN, HIGH);
  delay(200);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  float sumX = 0, sumY = 0, sumZ = 0;
  for (int i = 0; i < 200; i++) {
    mpu.getEvent(&a, &g, &temp);
    sumX += g.gyro.x;
    sumY += g.gyro.y;
    sumZ += g.gyro.z;
    delay(10);
  }
  gyroXoffset = sumX / 200;
  gyroYoffset = sumY / 200;
  gyroZoffset = sumZ / 200;
  gyroX = 0; gyroY = 0; gyroZ = 0;

  // Buzzer + LED 2x tanda selesai
  for (int i = 0; i < 2; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    digitalWrite(LED_PIN, HIGH);
    delay(100);
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(LED_PIN, LOW);
    delay(100);
  }
  Serial.println("Kalibrasi selesai!");
}

// ── Init ──────────────────────────────────────────────────
void initMPU() {
  if (!mpu.begin()) {
    Serial.println("MPU6050 tidak ditemukan!");
    while (1) { delay(10); }
  }
  Serial.println("MPU6050 Found!");
  calibrateMPU();
}

void initWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(1000);
  }
  Serial.println("\nESP32 IP: " + WiFi.localIP().toString());
}

// ── LED + Buzzer otomatis ─────────────────────────────────
void checkAlarm() {
  bool isWarning = (abs(gyroX) > THRESHOLD || abs(gyroY) > THRESHOLD);

  if (isWarning) {
    // Buzzer selalu nyala saat warning
    digitalWrite(BUZZER_PIN, HIGH);

    // LED kedap-kedip setiap 200ms
    if ((millis() - lastLed) > 200) {
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState);
      lastLed = millis();
    }
  } else {
    // Normal: buzzer dan LED mati
    digitalWrite(BUZZER_PIN, LOW);
    digitalWrite(LED_PIN, LOW);
    ledState = false;
  }
}

// ── Callback dari Flask ───────────────────────────────────
void onMessageCallback(WebsocketsMessage message) {
  JSONVar obj = JSON.parse(message.data());
  if (JSON.typeof(obj) != "object") return;
  if ((bool)obj["resetX"])    { gyroX = 0; }
  if ((bool)obj["resetY"])    { gyroY = 0; }
  if ((bool)obj["resetZ"])    { gyroZ = 0; }
  if ((bool)obj["calibrate"]) { calibrateMPU(); }
  if (obj.hasOwnProperty("threshold")) {
    THRESHOLD = (double)obj["threshold"];
  }
}

void onEventsCallback(WebsocketsEvent event, String data) {
  if (event == WebsocketsEvent::ConnectionOpened) {
    wsConnected = true;
    Serial.println("WebSocket terhubung!");
  } else if (event == WebsocketsEvent::ConnectionClosed) {
    wsConnected = false;
    Serial.println("WebSocket terputus!");
  }
}

void connectToFlask() {
  Serial.println("Mencoba connect ke Flask...");
  wsClient.setInsecure();
  wsClient.onMessage(onMessageCallback);
  wsClient.onEvent(onEventsCallback);
  wsClient.connect(wsServer);
}

// ── Update sensor ─────────────────────────────────────────
void updateGyro() {
  mpu.getEvent(&a, &g, &temp);
  float gX = g.gyro.x - gyroXoffset;
  float gY = g.gyro.y - gyroYoffset;
  float gZ = g.gyro.z - gyroZoffset;
  if (abs(gX) > gyroXerror) gyroX += gX / 50.00;
  if (abs(gY) > gyroYerror) gyroY += gY / 70.00;
  if (abs(gZ) > gyroZerror) gyroZ += gZ / 90.00;
}

void updateAcc() {
  mpu.getEvent(&a, &g, &temp);
  accX = a.acceleration.x;
  accY = a.acceleration.y;
  accZ = a.acceleration.z;
}

void updateTemperature() {
  mpu.getEvent(&a, &g, &temp);
  temperature = temp.temperature;
}

void sendData() {
  if (!wsConnected) return;
  bool isWarning = (abs(gyroX) > THRESHOLD || abs(gyroY) > THRESHOLD);
  String p = "{";
  p += "\"gyroX\":\""       + String(gyroX)       + "\",";
  p += "\"gyroY\":\""       + String(gyroY)       + "\",";
  p += "\"gyroZ\":\""       + String(gyroZ)       + "\",";
  p += "\"accX\":\""        + String(accX)        + "\",";
  p += "\"accY\":\""        + String(accY)        + "\",";
  p += "\"accZ\":\""        + String(accZ)        + "\",";
  p += "\"temperature\":\"" + String(temperature) + "\",";
  p += "\"warning\":"       + String(isWarning ? "true" : "false");
  p += "}";
  wsClient.send(p);
}

// ── Setup & Loop ──────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
  initWiFi();
  initMPU();
  connectToFlask();
}

void loop() {
  wsClient.poll();

  if (!wsConnected && (millis() - lastReconn) > 3000) {
    connectToFlask();
    lastReconn = millis();
  }

  if ((millis() - lastGyro) > 10)   { updateGyro();        lastGyro  = millis(); }
  if ((millis() - lastAcc)  > 200)  { updateAcc();         lastAcc   = millis(); }
  if ((millis() - lastTemp) > 1000) { updateTemperature(); lastTemp  = millis(); }

  checkAlarm();

  if ((millis() - lastSend) > 50) { sendData(); lastSend = millis(); }
}
