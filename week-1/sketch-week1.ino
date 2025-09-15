// in conjunction with PComp Week 1 Switch Assignment
// SWITCH: the act of eyes opening (LED OFF) / blinking (LED ON)

// 
int LED_PIN = 2;

void setup() {
  Serial.begin(9600);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim(); 

    if (cmd == "BLINK") {
      Serial.println("blink");
      digitalWrite(LED_PIN, HIGH);
    } else if (cmd == "OPEN") {
      Serial.println("open eyes");
      digitalWrite(LED_PIN, LOW);
    }
  }
}
