# RetroPad Editor
Online tool to create and edit onscreen gamepads for RetroArch.

https://valent-in.github.io/retropad-editor/

Features:
- Create, move, resize buttons of virtual gamepad (drag buttons and their corner handles, or use sliders).
- Undo and redo.
- Works offline and can be installed as an app.
- View options and themes are remembered.
- Unsaved work is kept in the browser and can be restored on next visit.
- Starter templates for popular consoles.
- Multiple layers; auto switch orientation for portrait overlays.
- Fix overlay aspect ratio.
- Import image resources in addition to 'flat' image set.
- Drag and drop config and image files onto the page.
- Export config and its images together as a ZIP archive.
- Scale viewport for comfortable editing on small screens.
- Display sensitivity range for analog sticks.
- Test mode to try touch areas, and a check for problems before export.
- Old format support (auto normalize integer overlays).
- Non-fullscreen overlays support.

Config file and images must be stored in same folder.
On most Android devices RetroArch will open config only from internal memory even access to sdcard is granted.
- This editor can load but NOT save configs with image paths (img/A.png will be saved as A.png)

Keyboard shortcuts:
- Arrows: move selection (Shift for larger steps).
- Delete: delete selected button.
- Ctrl+D: duplicate selection.
- Esc: close dialog or clear selection.
- Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z: undo, redo.

Development:
- The site is static files with no build step.
- `npm test` runs unit tests.
- `npm run test:browser` runs browser checks using installed Microsoft Edge (set `BROWSER_CHANNEL=chrome` for Chrome).
---
Libretro Docs: https://docs.libretro.com/development/retroarch/input/overlay/

Used media resources from https://github.com/libretro/common-overlays (button images) and https://github.com/libretro/RetroArch (icon).

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License version 3.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY.