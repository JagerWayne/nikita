/* Procedural canvas textures for walls, floors and hazards. */
import * as THREE from 'three';

export function createProceduralTextures() {
  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = 256; wallCanvas.height = 256;
  const wctx = wallCanvas.getContext('2d');
  wctx.fillStyle = '#40535e';
  wctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    wctx.fillStyle = y % 4 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)';
    wctx.fillRect(0, y, 256, 1);
  }
  wctx.strokeStyle = '#1f2b32';
  wctx.lineWidth = 4;
  wctx.strokeRect(4, 4, 248, 248);
  wctx.strokeRect(4, 128, 248, 124);
  wctx.fillStyle = '#738d9c';
  const rivets = [[14,14],[242,14],[14,118],[242,118],[14,138],[242,138],[14,242],[242,242]];
  for (const [rx, ry] of rivets) { wctx.beginPath(); wctx.arc(rx, ry, 3, 0, Math.PI * 2); wctx.fill(); }
  wctx.fillStyle = '#00ff99';
  wctx.fillRect(0, 210, 256, 8);
  wctx.fillStyle = 'rgba(0, 255, 153, 0.32)';
  wctx.fillRect(0, 203, 256, 22);
  const wallTex = new THREE.CanvasTexture(wallCanvas);
  wallTex.colorSpace = THREE.SRGBColorSpace;

  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 256; floorCanvas.height = 256;
  const fctx = floorCanvas.getContext('2d');
  fctx.fillStyle = '#1d2e29';
  fctx.fillRect(0, 0, 256, 256);
  fctx.strokeStyle = '#33574d';
  fctx.lineWidth = 2;
  for (let i = 0; i <= 256; i += 64) {
    fctx.beginPath(); fctx.moveTo(i, 0); fctx.lineTo(i, 256); fctx.stroke();
    fctx.beginPath(); fctx.moveTo(0, i); fctx.lineTo(256, i); fctx.stroke();
  }
  fctx.strokeStyle = 'rgba(0, 255, 150, 0.52)';
  fctx.lineWidth = 3;
  fctx.strokeRect(2, 2, 252, 252);
  fctx.fillStyle = 'rgba(0, 255, 150, 0.35)';
  fctx.fillRect(122, 126, 12, 4);
  fctx.fillRect(126, 122, 4, 12);
  const floorTex = new THREE.CanvasTexture(floorCanvas);
  floorTex.colorSpace = THREE.SRGBColorSpace;

  const runCanvas = document.createElement('canvas');
  runCanvas.width = 256; runCanvas.height = 256;
  const rctx = runCanvas.getContext('2d');
  rctx.drawImage(floorCanvas, 0, 0);
  rctx.strokeStyle = '#00ff99';
  rctx.lineWidth = 14;
  rctx.beginPath();
  rctx.moveTo(46, 176); rctx.lineTo(128, 76); rctx.lineTo(210, 176);
  rctx.stroke();
  rctx.strokeStyle = 'rgba(255, 185, 20, 0.85)';
  rctx.lineWidth = 6;
  rctx.strokeRect(10, 0, 10, 256);
  rctx.strokeRect(236, 0, 10, 256);
  const runwayTex = new THREE.CanvasTexture(runCanvas);
  runwayTex.colorSpace = THREE.SRGBColorSpace;

  const hazCanvas = document.createElement('canvas');
  hazCanvas.width = 256; hazCanvas.height = 256;
  const hctx = hazCanvas.getContext('2d');
  hctx.fillStyle = '#f5b800';
  hctx.fillRect(0, 0, 256, 256);
  hctx.fillStyle = '#1d2022';
  for (let i = -256; i < 512; i += 48) {
    hctx.beginPath();
    hctx.moveTo(i, 0); hctx.lineTo(i + 24, 0);
    hctx.lineTo(i - 232, 256); hctx.lineTo(i - 256, 256);
    hctx.closePath();
    hctx.fill();
  }
  const hazardTex = new THREE.CanvasTexture(hazCanvas);
  hazardTex.colorSpace = THREE.SRGBColorSpace;

  const ceilCanvas = document.createElement('canvas');
  ceilCanvas.width = 128; ceilCanvas.height = 128;
  const cctx = ceilCanvas.getContext('2d');
  cctx.fillStyle = '#26353b';
  cctx.fillRect(0, 0, 128, 128);
  cctx.strokeStyle = '#152024';
  cctx.lineWidth = 4;
  cctx.strokeRect(2, 2, 124, 124);
  cctx.fillStyle = 'rgba(180, 245, 255, 0.45)';
  cctx.fillRect(24, 52, 80, 24);
  const ceilTex = new THREE.CanvasTexture(ceilCanvas);
  ceilTex.colorSpace = THREE.SRGBColorSpace;

  return { wallTex, floorTex, runwayTex, hazardTex, ceilTex };
}
