// reference
// https://docs.ml5js.org/#/reference/facemesh

let video;
let faceMesh;
let options = { maxFaces: 1, refineLandmarks: false, flipped: false };
let faces = [];
let results;

let closingThreshold = 0.2;

function preload() {
  // load the faceMesh model
  faceMesh = ml5.faceMesh(options);
  console.log('ml5 facemesh is loaded');
}

function setup() {
  createCanvas(640, 480);
  video = createCapture(VIDEO);
  video.size(640, 480);
  video.hide();

  faceMesh.detectStart(video, gotFaces);
}

function gotFaces(results) {
  faces = results;
}

function draw() {
  // image(video, 0, 0, width, height);

  if (faces.length > 0) {
    let face = faces[0];

    // left eye keypoints
    let left = [
      face.keypoints[33], // p1
      face.keypoints[160], // p2
      face.keypoints[158], // p3
      face.keypoints[133], // p4
      face.keypoints[153], // p5
      face.keypoints[144], // p6
    ];

    // right eye keypoints
    let right = [
      face.keypoints[362], // p1
      face.keypoints[385], // p2
      face.keypoints[387], // p3
      face.keypoints[263], // p4
      face.keypoints[373], // p5
      face.keypoints[380], // p6
    ];

    // compute Eye Aspect Ratio
    // reference: https://scispace.com/pdf/a-review-on-eye-aspect-ratio-technique-3v4bhqqh.pdf
    // (p2-p1) + (p3-p5) / 2(p1-p2)
    let leftEAR =
      (dist(left[1].x, left[1].y, left[5].x, left[5].y) +
        dist(left[2].x, left[2].y, left[4].x, left[4].y)) /
      (2 * dist(left[0].x, left[0].y, left[3].x, left[3].y));

    let rightEAR =
      (dist(right[1].x, right[1].y, right[5].x, right[5].y) +
        dist(right[2].x, right[2].y, right[4].x, right[4].y)) /
      (2 * dist(right[0].x, right[0].y, right[3].x, right[3].y));

    // todo: add rightEAR check

    // eyes closing check, for now: left eye first
    if (leftEAR < closingThreshold) {
      console.log('Left eye closed!');
      // call updateOverlay method on index.js
      updateOverlay(true);
    } else {
      updateOverlay(false);
    }
  }
}
