# 3D look prototype

A look-only prototype, not gameplay. Open `index.html` directly in a browser
(it pulls three.js r170 from jsDelivr). Renders the same composition as the 2D
game - dark warehouse, three warm lamps, one rack, the wave-9 manifest - in real
3D: PBR materials, PCF soft shadow maps, ACES tone mapping and bloom, at the
same device-resolution policy as the game.

Everything is procedural: no models, no texture files. That is the honest
ceiling of what code alone produces. It exists to answer "what would 3D
actually look like here" with a picture instead of an opinion.

Not wired to the Vite build or dev server (the importmap is CDN-based).
