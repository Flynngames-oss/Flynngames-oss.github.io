// Real photo textures, loaded before the island is built (each one falls back to the hand-painted texture if it
// can't load). Credits:
//  Babylon.js Assets (CC BY 4.0): grass, cobblestones, gravel (made into asphalt and concrete), dirt, sand, bark,
//  leaves.  Godot demo projects (MIT): rock, bricks.
import * as THREE from 'three';

const FILES = {
  grass: 'assets/tx_grass.jpg', grassN: 'assets/tx_grass_n.jpg',
  pavers: 'assets/tx_pavers.jpg', paversN: 'assets/tx_pavers_n.jpg',
  asphalt: 'assets/tx_asphalt.jpg', asphaltN: 'assets/tx_asphalt_n.jpg',
  concrete: 'assets/tx_concrete.jpg', concreteN: 'assets/tx_concrete_n.jpg',
  dirt: 'assets/tx_dirt.jpg', sand: 'assets/tx_sand.jpg', rock: 'assets/tx_rock.jpg',
  bricks: 'assets/tx_bricks.jpg', bricksN: 'assets/tx_bricks_n.jpg',
  bark: 'assets/tx_bark.jpg', barkN: 'assets/tx_bark_n.jpg',
  leaves: 'assets/tx_leaves.webp',
};
// average colour of each photo (linear), so the ground shader can tint them to match each part of the island
export const AVG = {
  grass: [0.1965, 0.3334, 0.0584], pavers: [0.1805, 0.1768, 0.1576], dirt: [0.3026, 0.1806, 0.0653], sand: [0.5152, 0.3363, 0.1434],
  asphalt: [0.0908, 0.0908, 0.0973], concrete: [0.4905, 0.4905, 0.4674], rock: [0.2642, 0.2219, 0.1981], bricks: [0.2233, 0.1273, 0.0819],
};
export const PH = {};

export async function loadPhotos(renderer, onProgress) {
  const L = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const keys = Object.keys(FILES);
  let done = 0;
  await Promise.all(keys.map((k) => L.loadAsync(FILES[k]).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (!k.endsWith('N')) t.colorSpace = THREE.SRGBColorSpace;
    PH[k] = t;
  }).catch(() => console.warn('photo texture missing:', FILES[k])).finally(() => onProgress && onProgress(++done / keys.length))));
  return PH;
}
