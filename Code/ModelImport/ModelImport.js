import * as THREE from '../../../Common/three.js-r170/build/three.module.js';
import { TrackballControls } from '../../../Common/three.js-r170/examples/jsm/controls/TrackballControls.js';

import { GLTFLoader } from '../../../Common/three.js-r170/examples/jsm/loaders/GLTFLoader.js';

let camera, controls, scene, renderer, canvas;
const clock = new THREE.Clock();
let mixer = null;

function main() {
  canvas = document.getElementById("gl-canvas");
  renderer = new THREE.WebGLRenderer({ canvas });
  renderer.shadowMap.enabled = true;

  const fov = 45;
  const aspect = 2;  // the canvas default
  const near = 0.1;
  const far = 5000;
  camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(0, 10, 20);


  createControls(camera);
  controls.update();

  scene = new THREE.Scene();
  scene.background = new THREE.Color('black');

  //
  const planeSize = 40;

  const planeGeo = new THREE.PlaneGeometry(planeSize, planeSize);
  const planeMat = new THREE.MeshPhongMaterial({
    color: 0xADD8E6,
    side: THREE.DoubleSide,
  });
  const PlaneMesh = new THREE.Mesh(planeGeo, planeMat);
  PlaneMesh.receiveShadow = true;
  PlaneMesh.rotation.x = Math.PI * -.5;
  scene.add(PlaneMesh);

  //
  const cubeSize = 4;
  const cubeGeo = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
  const cubeMat = new THREE.MeshPhongMaterial({ color: '#AAC' });
  const cubeMesh = new THREE.Mesh(cubeGeo, cubeMat);
  cubeMesh.castShadow = true;
  cubeMesh.receiveShadow = true;
  cubeMesh.position.set(cubeSize + 1, cubeSize / 2, 0);
  scene.add(cubeMesh);


  //
  const ExtCubeSize = 30;
  const ExtCubeGeo = new THREE.BoxGeometry(ExtCubeSize, ExtCubeSize, ExtCubeSize);
  const ExtCubeMat = new THREE.MeshPhongMaterial({
    color: '#CCC',
    side: THREE.BackSide,
  });
  const ExtMeshCube = new THREE.Mesh(ExtCubeGeo, ExtCubeMat);
  ExtMeshCube.receiveShadow = true;
  ExtMeshCube.position.set(0, ExtCubeSize / 2 - 0.1, 0);
  scene.add(ExtMeshCube);

  const loader = new GLTFLoader();

  loader.load('../GlTF_Models/glTF/Vehicle_Pickup_Armored.gltf', function (gltf) {

    gltf.scene.position.set(-6, 3, -3);
    gltf.scene.scale.set(0.05, 0.05, 0.05);
    gltf.scene.rotation.set(0, Math.PI * (1 / 4), 0);

    gltf.scene.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });


    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(gltf.scene);
      const action = mixer.clipAction(gltf.animations[0]);zz
      action.play(); //激活动作 然后在渲染部分调用mixer.update(dt)更新动作
    }
    
    scene.add(gltf.scene);

  }, undefined, function (error) {

    console.error(error);

  });


  const ambLight = new THREE.AmbientLight(0x404040, 10); // soft white light
  scene.add(ambLight);



  const color = 0xFFFFFF;
  const intensity = 750;
  const light = new THREE.PointLight(color, intensity);
  light.castShadow = true;
  light.position.set(5, 10, 8);
  scene.add(light);

  const helper = new THREE.PointLightHelper(light);
  scene.add(helper);

  requestAnimationFrame(render);

  window.addEventListener('resize', onWindowResize);

}

function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const needResize = canvas.width !== width || canvas.height !== height;
  if (needResize) {
    renderer.setSize(width, height, false);
  }
  return needResize;
}

function render() {

  resizeRendererToDisplaySize(renderer);

  {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }
  controls.update();

  renderer.render(scene, camera);
  const dt = clock.getDelta();     // 秒
  if (mixer) mixer.update(dt);

  requestAnimationFrame(render);
}

function onWindowResize() {

  const aspect = window.innerWidth / window.innerHeight;

  camera.aspect = aspect;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.render(scene, camera);

}

function createControls(camera) {

  controls = new TrackballControls(camera, renderer.domElement);

  controls.rotateSpeed = 1.0;
  controls.zoomSpeed = 5;
  controls.panSpeed = 0.8;

  //     This array holds keycodes for controlling interactions.

  // When the first defined key is pressed, all mouse interactions (left, middle, right) performs orbiting.
  // When the second defined key is pressed, all mouse interactions (left, middle, right) performs zooming.
  // When the third defined key is pressed, all mouse interactions (left, middle, right) performs panning.
  // Default is KeyA, KeyS, KeyD which represents A, S, D.
  controls.keys = ['KeyA', 'KeyS', 'KeyD'];



}

main();