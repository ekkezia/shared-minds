// Simple Arduino sketch to read a photoresistor and control a buzzer via serial commands
// The force sensor will change the frequency of the buzzer 
// The buzzer will only make a sound when user is blinking (therefore the arduino.js will send "BLINK" command via serial)
// Upload the Arduino code before running this web app and then close the Arduino IDE. Two apps / programs cannot be running the same port.

void setup() {
  Serial.begin(9600);   // initialize serial communication
}

void loop() {
  
  int forceSensor = analogRead(A0);   // Photoresistor
  int freq = map(forceSensor,0, 1024, 350,440);
      Serial.println(freq);

  if (Serial.available()) {
          Serial.println("Serial is available");

    String cmd = Serial.readStringUntil('\n');
    cmd.trim(); 

    if (cmd == "BLINK") {
      Serial.println("blink");
      tone(2, freq, 500);
    } else if (cmd == "OPEN") {
      Serial.println("open eyes");
      noTone(2);            
    }
  }

  // delay(1000); // small delay to make serial output readable
}
