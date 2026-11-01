//Default screen dimensions (16:9 - compatible with built-in overlays) 
const DEF_WIDTH = 800;
const DEF_HEIGHT = 450;
const DEF_SCR_WIDTH = 600;
const DEF_SCR_HEIGHT = 450;

const defaultParamsForNewOverlay = 'full_screen = true\nnormalized = true\nrange_mod = 1.5\nalpha_mod = 2.0';
const autoScaleParams = 'auto_x_separation = true\n'; //auto_y_separation = ?
const manualScaleParams = 'block_x_separation = false\nblock_y_separation = false';

const DRAG_THRESHOLD_PX = 3;
const MIN_BUTTON_SIZE = 0.001;
const SNAP_THRESHOLD = 0.008;
const SNAP_GRID_STEP = 0.05;
const ZOOM_FACTOR = 1.25;
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 5;
const HISTORY_LIMIT = 100;
const AUTOSAVE_DELAY_MS = 500;
const PREFERENCES_KEY = 'retropad-editor-preferences';
const PREFERENCE_CHECKBOXES = ['chk-show-shapes', 'chk-show-names', 'chk-show-offscreen', 'chk-snap'];
const NUDGE_STEP = 0.001;
const NUDGE_STEP_LARGE = 0.01;
const DUPLICATE_OFFSET = 0.02;
const NEW_BUTTON_HALF_HEIGHT = 0.08;
const CUSTOM_COMMAND = '__custom';
const SVG_NS = 'http://www.w3.org/2000/svg';
const THEME_COLORS = { light: '#fbfaf7', dark: '#1c1b1f' };

let importedFilename = 'retropad.cfg';
let savedConfigStr;
let currentRect;
let suppressRectClick = false;
let selectionBeforeMouseDown = [];
let selectedBeforePress = null;
let isSpaceHeld = false;
let isZoomFit = true;
let isTestMode = false;
let dialogFocusStack = [];
let isLoadingPreferences = true;
let colorSchemeIndex = 0;
let cancelActiveDrag = null;

let undoStack = [];
let redoStack = [];
let historyCurrentStr;

let isAutosaveReady = false;
let autosaveTimer = null;
let pendingSession = null;

let screen = {
	_width: DEF_WIDTH,
	_height: DEF_HEIGHT,

	isSetByUser: false,
	isPortrait: false,

	zoom: 1,

	get longSide() { return Math.max(this._height, this._width) },
	get shortSide() { return Math.min(this._height, this._width) },

	set width(value) { this._width = Number(value || screen._width || DEF_WIDTH) },
	get enteredWidth() { return this.isPortrait ? this.shortSide : this.longSide },
	get width() { return this.enteredWidth * this.zoom },

	set height(value) { this._height = Number(value || screen._height || DEF_HEIGHT) },
	get enteredHeight() { return this.isPortrait ? this.longSide : this.shortSide },
	get height() { return this.enteredHeight * this.zoom },

	shotFrameWidth: DEF_SCR_WIDTH,
	shotFrameHeight: DEF_SCR_HEIGHT,

	shotImage: null,
	// screenshot image dimensions
	shotWidth: 0,
	shotHeight: 0,

	shotShow: true,
	shotMode: 'fit', // fit, set, match
}

let images = {};
if (defaultImagesObj) // defaults.js
	images = defaultImagesObj;

let userImages = [];

fillCommandSelector(buttonCommandGroups);
fillTemplateSelector();
fillAddButtonDialog();

let conf = new ConfigHandler();
let configStr = defaultConfigString; // defaults.js
renderConfig(configStr);

'xywh'.split('').forEach(elem => {
	let range = document.getElementById(elem + '-range');
	let text = document.getElementById(elem + '-number');

	range.addEventListener('input', (e) => {
		applyButtonParam(elem, e.target.value);
		text.value = e.target.value;
	});

	text.addEventListener('input', (e) => {
		// field is empty while retyping value (or contains invalid number)
		if (e.target.value === '')
			return;

		applyButtonParam(elem, e.target.value);
		range.value = e.target.value;
	});

	range.addEventListener('change', commitHistory);
	text.addEventListener('change', commitHistory);
});

document.getElementById('chk-show-shapes').addEventListener('change', toggleShapes);
document.getElementById('chk-show-names').addEventListener('change', toggleNames);
document.getElementById('chk-show-portrait').addEventListener('change', toggleOrientation);
document.getElementById('chk-show-offscreen').addEventListener('change', toggleOffscreen);
document.getElementById('chk-snap').addEventListener('change', toggleSnap);
document.getElementById('chk-test-mode').addEventListener('change', toggleTestMode);

document.getElementById('command-select').addEventListener('change', fillCommandField);
document.getElementById('command-name').addEventListener('change', applyButtonEdit);
document.getElementById('image-name').addEventListener('input', e => showImagePreview(e.target.value));
document.getElementById('image-name').addEventListener('change', applyButtonEdit);
document.querySelectorAll('input[name=button-shape]').forEach(e => e.addEventListener('change', applyButtonEdit));
document.querySelectorAll('.js-additional-button-property input, .js-additional-button-property select, #raw-button-properties').forEach(e => e.addEventListener('change', applyButtonEdit));
document.getElementById('overlay-current-name').addEventListener('change', applyOverlayEdit);
document.getElementById('raw-overlay-current').addEventListener('change', applyOverlayEdit);
document.getElementById('image-picker-filter').addEventListener('input', fillImagePicker);

document.getElementById('load-config').addEventListener('change', loadConfigFromFile);
document.getElementById('load-button-images').addEventListener('change', loadImageFiles);
document.getElementById('load-screenshot').addEventListener('change', loadScreenshotFile);
document.getElementById('chk-show-screenshot').addEventListener('change', toggleScreenshot);

window.addEventListener('pointerdown', () => { suppressRectClick = false }, true);

window.addEventListener('dragover', onFileDragOver);
window.addEventListener('drop', onFileDrop);
window.addEventListener('dragleave', e => {
	if (!e.relatedTarget)
		document.body.classList.remove('is-file-dragging');
});

{
	let padContainer = document.getElementById('gamepad-container');
	padContainer.addEventListener('wheel', onCanvasWheel, { passive: false });
	padContainer.addEventListener('pointerdown', onCanvasPanStart, true);

	new ResizeObserver(() => {
		if (isZoomFit)
			updateScreenSize();
	}).observe(padContainer);

	// Panning must not start selection or button drag
	padContainer.addEventListener('mousedown', e => {
		if (e.button == 1 || isSpaceHeld) {
			e.preventDefault();
			e.stopPropagation();
		}
	}, true);
}

document.addEventListener('keydown', e => {
	if (e.code != 'Space' || e.target.matches('input, textarea, select'))
		return;

	// Space keeps its usual action on focused button unless pointer is over canvas
	if (e.target.matches('button') && !document.getElementById('gamepad-container').matches(':hover'))
		return;

	isSpaceHeld = true;
	e.preventDefault();
});
document.addEventListener('keyup', e => {
	if (e.code == 'Space' && isSpaceHeld) {
		isSpaceHeld = false;
		e.preventDefault();
	}
});

document.addEventListener('keydown', closeTopDialogOnEscape);
document.addEventListener('keydown', trapDialogFocus);
document.addEventListener('keydown', handleShortcuts);
document.addEventListener('keyup', e => {
	if (e.key.startsWith('Arrow'))
		commitHistory();
});
window.addEventListener('beforeunload', warnAboutUnsavedChanges);
window.addEventListener('beforeunload', flushPendingAutosave);
document.addEventListener('visibilitychange', () => {
	if (document.visibilityState == 'hidden')
		flushPendingAutosave();
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
	setAppTheme(document.getElementById('app-theme').value);
});
setAppTheme('auto');

PREFERENCE_CHECKBOXES.forEach(id => document.getElementById(id).addEventListener('change', savePreferences));
loadPreferences();

checkForSavedSession();

if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
	navigator.serviceWorker.register('sw.js').catch(console.error);


function applyButtonParam(section, sValue) {
	let value = Number(sValue);

	if (conf.isGroupSelected()) {
		conf.setSelectionSectionValue(section, value);
		syncSelectedButtons();
	} else {
		updateCurrentLine(section, value);
	}
}


function createPadView() {
	let background = createPadBackground();
	let rects = conf.buildPadFromConfig();
	if (!rects)
		return;

	buildButtonList(rects);

	for (let i = 0; i < rects.length; i++) {
		let r = rects[i];
		let b = createRect(background, r.command, r.x, r.y, r.w, r.h, r.pct);

		if (images[r.img]) {
			b.style['background-image'] = 'url(' + images[r.img] + ')';
		} else if (r.img) {
			b.classList.add('missing-image');
			b.title = 'Missing image: ' + r.img;
		}

		if (r.s == 'radial')
			b.classList.add('radial');

		b.dataset.lineIndex = r.i;
		if (conf.isLineInSelection(r.i))
			b.classList.add('selected');

		b.addEventListener('pointerdown', e => onRectPointerDown(e, b, r.i));

		// Shift + drag starts selection box from a button
		b.addEventListener('mousedown', e => {
			if (!e.shiftKey) {
				e.stopPropagation();
				e.preventDefault();
			}
		});

		b.addEventListener('click', (e) => {
			if (suppressRectClick) {
				suppressRectClick = false;
				return;
			}

			if (e.ctrlKey || e.metaKey || e.shiftKey) {
				toggleRectInSelection(r.i, e.shiftKey ? selectionBeforeMouseDown : getSelectedLines());
				document.activeElement.blur();
				return;
			}

			let next = getNextOverlappingRect(b, e);
			selectRect(next, Number(next.dataset.lineIndex));
			document.activeElement.blur();
		});
	}

	if (isTestMode)
		buildTestLayer(background);

	keepLabelsOnScreen();
}


// Names of buttons at the screen edge are moved inside, so they are not cut off
function keepLabelsOnScreen() {
	let bounds = document.getElementById('screenpad').getBoundingClientRect();

	document.querySelectorAll('#screenpad .rect__label').forEach(label => {
		let rect = label.parentElement.getBoundingClientRect();
		let isOutside = rect.right <= bounds.left || rect.left >= bounds.right || rect.bottom <= bounds.top || rect.top >= bounds.bottom;
		let shiftX = 0;
		let shiftY = 0;

		if (!isOutside) {
			let size = label.getBoundingClientRect();
			let left = rect.left + (rect.width - size.width) / 2;
			shiftX = Math.max(bounds.left - left, 0) + Math.min(bounds.right - left - size.width, 0);
			shiftY = Math.max(bounds.top + size.height - rect.bottom, 0) + Math.min(bounds.bottom - rect.bottom, 0);
		}

		label.style.setProperty('--label-shift-x', shiftX + 'px');
		label.style.setProperty('--label-shift-y', shiftY + 'px');
	});
}


function toggleTestMode(event) {
	setTestMode(event.target.checked);
}


function setTestMode(isOn) {
	isTestMode = isOn;

	document.getElementById('chk-test-mode').checked = isOn;
	document.getElementById('test-banner').classList.toggle('hidden', !isOn);
	document.body.classList.toggle('is-testing', isOn);
	document.getElementById('panel-outline').inert = isOn;
	document.getElementById('inspector').inert = isOn;

	deselectAll();
	conf.setCurrentLine(-1);
	currentRect = null;
	redrawPad();
}


function buildTestLayer(container) {
	let layer = document.createElement('DIV');
	layer.id = 'test-layer';

	let readout = document.createElement('DIV');
	readout.id = 'test-readout';
	layer.appendChild(readout);

	let areas = conf.getHitAreas(conf.getCurrentOverlay());
	let areaElements = areas.map(area => {
		let element = document.createElement('DIV');
		element.classList.add('hit-area');
		element.classList.toggle('radial', area.shape == 'radial');
		element.style.left = (area.x - area.w) * 100 + '%';
		element.style.top = (area.y - area.h) * 100 + '%';
		element.style.width = area.w * 200 + '%';
		element.style.height = area.h * 200 + '%';
		layer.appendChild(element);
		return element;
	});

	let pointers = new Map();

	let update = () => {
		let frame = layer.getBoundingClientRect();
		let pressed = [];

		areas.forEach((area, i) => {
			let isPressed = Array.from(pointers.values()).some(p =>
				conf.isPointInHitArea(area, (p.x - frame.left) / frame.width, (p.y - frame.top) / frame.height));

			areaElements[i].classList.toggle('pressed', isPressed);
			if (isPressed)
				pressed.push(area.command);
		});

		readout.textContent = pressed.join(' + ');
	};

	let release = (event) => {
		pointers.delete(event.pointerId);
		update();
	};

	layer.addEventListener('pointerdown', event => {
		layer.setPointerCapture(event.pointerId);
		pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		update();
	});
	layer.addEventListener('pointermove', event => {
		if (pointers.has(event.pointerId)) {
			pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			update();
		}
	});
	layer.addEventListener('pointerup', release);
	layer.addEventListener('pointercancel', release);

	// Canvas selection must not start from this layer
	layer.addEventListener('mousedown', event => event.stopPropagation());
	layer.addEventListener('touchstart', event => event.stopPropagation());

	container.appendChild(layer);
}


function buildButtonList(rects) {
	let list = document.getElementById('button-list');
	list.innerHTML = '';

	if (rects.length == 0) {
		let empty = document.createElement('LI');
		empty.classList.add('row-empty');
		empty.textContent = 'No buttons yet. Add one to get started.';
		list.appendChild(empty);
		return;
	}

	rects.slice().sort((a, b) => a.number - b.number).forEach(r => {
		let row = document.createElement('LI');
		row.dataset.lineIndex = r.i;

		let main = document.createElement('BUTTON');
		main.classList.add('row-main');
		main.addEventListener('click', e => {
			if (e.ctrlKey || e.metaKey || e.shiftKey)
				toggleRectInSelection(r.i, getSelectedLines());
			else
				selectRectByLine(r.i);
		});

		let thumb = document.createElement('SPAN');
		thumb.classList.add('row-thumb');
		if (images[r.img])
			thumb.style['background-image'] = 'url(' + images[r.img] + ')';

		let name = document.createElement('SPAN');
		name.classList.add('row-main__text', 'row-main__command');
		name.textContent = r.command;

		main.appendChild(thumb);
		main.appendChild(name);
		row.appendChild(main);

		let actions = document.createElement('SPAN');
		actions.classList.add('row-actions');
		actions.appendChild(createListMoveButton('i-up', 'Move up in the list', r.i, -1));
		actions.appendChild(createListMoveButton('i-down', 'Move down in the list', r.i, 1));
		row.appendChild(actions);

		list.appendChild(row);
	});
}


function createListMoveButton(icon, title, lineIndex, direction) {
	let button = document.createElement('BUTTON');
	button.title = title;
	button.setAttribute('aria-label', title);
	button.appendChild(createIcon(icon));
	button.addEventListener('click', () => moveButtonInList(lineIndex, direction));
	return button;
}


function createIcon(name) {
	let svg = document.createElementNS(SVG_NS, 'svg');
	svg.classList.add('icon', 'icon--small');

	let use = document.createElementNS(SVG_NS, 'use');
	use.setAttribute('href', '#' + name);
	svg.appendChild(use);

	return svg;
}


function selectRectByLine(lineIndex) {
	let rect = document.querySelector('.rect[data-line-index="' + lineIndex + '"]');
	if (rect && (conf.isGroupSelected() || !rect.classList.contains('selected')))
		selectRect(rect, lineIndex);
}


function moveButtonInList(lineIndex, direction) {
	let newIndex = conf.moveButton(lineIndex, direction);
	if (newIndex === null)
		return;

	redrawPad();
	selectRectByLine(newIndex);
}


function updateButtonListSelection() {
	document.querySelectorAll('#button-list li').forEach(row => {
		let rect = document.querySelector('.rect[data-line-index="' + row.dataset.lineIndex + '"]');
		row.classList.toggle('selected', !!rect && rect.classList.contains('selected'));
	});
}


function selectRect(rect, lineIndex) {
	deselectAll();

	conf.setCurrentLine(lineIndex);
	currentRect = rect;

	rect.classList.add('selected');
	showResizeHandles(rect);

	'xywh'.split('').forEach(elem => {
		let range = document.getElementById(elem + '-range');
		let text = document.getElementById(elem + '-number');
		text.value = conf.getCurrentLineSectionValue(elem);
		range.value = conf.getCurrentLineSectionValue(elem);
	});

	enableEditor(true);
}


function getNextOverlappingRect(clickedRect, event) {
	let stack = document.elementsFromPoint(event.clientX, event.clientY).filter(e => e.classList.contains('rect'));
	let index = stack.indexOf(selectedBeforePress);

	return index == -1 ? clickedRect : stack[(index + 1) % stack.length];
}


function getSelectedLines() {
	if (conf.isGroupSelected())
		return conf.getSelectedIndexes().slice();

	return document.getElementById('x-number').disabled ? [] : [conf.getCurrentLine()];
}


function toggleRectInSelection(lineIndex, lines) {
	let isIncluded = lines.includes(lineIndex);
	applySelection(isIncluded ? lines.filter(e => e != lineIndex) : lines.concat(lineIndex));
}


function applySelection(lines) {
	deselectAll();
	conf.setCurrentLine(-1);
	currentRect = null;

	if (lines.length == 0) {
		enableEditor(false);
		return;
	}

	if (lines.length == 1) {
		selectRect(document.querySelector('.rect[data-line-index="' + lines[0] + '"]'), lines[0]);
		return;
	}

	conf.setSelectedIndexes(lines);
	lines.forEach(e => document.querySelector('.rect[data-line-index="' + e + '"]').classList.add('selected'));
	setEditorControls();
}


function onRectPointerDown(event, rect, lineIndex) {
	if (event.button != 0 || event.shiftKey || event.ctrlKey || event.metaKey)
		return;

	selectedBeforePress = conf.isGroupSelected() ? null : currentRect;

	// Touch: first tap selects, so pad area can still be scrolled
	if (event.pointerType != 'mouse' && !rect.classList.contains('selected'))
		return;

	document.activeElement.blur();

	if (!rect.classList.contains('selected'))
		selectRect(rect, lineIndex);

	let start = conf.getSelectionDimensions() || {
		x: Number(conf.getCurrentLineSectionValue('x')),
		y: Number(conf.getCurrentLineSectionValue('y')),
		w: Number(conf.getCurrentLineSectionValue('w')),
		h: Number(conf.getCurrentLineSectionValue('h')),
	};
	let frame = rect.parentElement.getBoundingClientRect();
	let snapLines = getSnapLines();

	trackPointerDrag(rect, event, (dx, dy, moveEvent) => {
		let x = start.x + dx / frame.width;
		let y = start.y + dy / frame.height;

		if (isSnapActive(moveEvent)) {
			let snapX = findSnap([x - start.w, x, x + start.w], snapLines.x);
			let snapY = findSnap([y - start.h, y, y + start.h], snapLines.y);
			x += snapX ? snapX.delta : 0;
			y += snapY ? snapY.delta : 0;
			showSnapGuides(rect.parentElement, snapX, snapY);
		}

		setButtonParam('x', x);
		setButtonParam('y', y);
	});
}


function isSnapActive(event) {
	return document.getElementById('chk-snap').checked && !event.altKey;
}


// Lines of buttons that are not moved
function getSnapLines() {
	let selected = conf.isGroupSelected() ? conf.getSelectedIndexes() : [conf.getCurrentLine()];
	let lines = { x: [0.5], y: [0.5] };

	conf.buildPadFromConfig().forEach(b => {
		if (selected.includes(b.i))
			return;

		let x = Number(b.x), y = Number(b.y), w = Number(b.w), h = Number(b.h);
		lines.x.push(x - w, x, x + w);
		lines.y.push(y - h, y, y + h);
	});

	return lines;
}


// Button lines take priority over grid
function findSnap(values, lines) {
	let closest = (candidates) => {
		let best = null;

		values.forEach(value => {
			candidates(value).forEach(line => {
				let delta = line - value;
				if (Math.abs(delta) < SNAP_THRESHOLD && (!best || Math.abs(delta) < Math.abs(best.delta)))
					best = { delta: delta, line: line };
			});
		});

		return best;
	};

	return closest(() => lines) || closest(value => [Math.round(value / SNAP_GRID_STEP) * SNAP_GRID_STEP]);
}


function showSnapGuides(container, snapX, snapY) {
	removeSnapGuides();

	[['x', snapX], ['y', snapY]].forEach(([axis, snap]) => {
		if (!snap)
			return;

		let guide = document.createElement('DIV');
		guide.classList.add('snap-guide');
		guide.classList.add('snap-guide--' + axis);
		guide.style[axis == 'x' ? 'left' : 'top'] = (snap.line * 100) + '%';
		container.appendChild(guide);
	});
}


function removeSnapGuides() {
	document.querySelectorAll('.snap-guide').forEach(e => e.remove());
}


function onResizeHandlePointerDown(event, rect, signX, signY) {
	event.stopPropagation();
	if (event.button != 0)
		return;

	document.activeElement.blur();

	let start = {};
	'xywh'.split('').forEach(elem => {
		start[elem] = Number(conf.getCurrentLineSectionValue(elem));
	});
	let frame = rect.parentElement.getBoundingClientRect();
	let snapLines = getSnapLines();

	// x, y are center coordinates and w, h are half sizes; opposite corner stays in place
	trackPointerDrag(event.target, event, (dx, dy, moveEvent) => {
		let w = Math.max(MIN_BUTTON_SIZE, start.w + signX * dx / frame.width / 2);
		let h = Math.max(MIN_BUTTON_SIZE, start.h + signY * dy / frame.height / 2);

		if (isSnapActive(moveEvent) && !moveEvent.shiftKey) {
			let snapX = findSnap([start.x + signX * (2 * w - start.w)], snapLines.x);
			let snapY = findSnap([start.y + signY * (2 * h - start.h)], snapLines.y);
			w = Math.max(MIN_BUTTON_SIZE, w + (snapX ? signX * snapX.delta / 2 : 0));
			h = Math.max(MIN_BUTTON_SIZE, h + (snapY ? signY * snapY.delta / 2 : 0));
			showSnapGuides(rect.parentElement, snapX, snapY);
		}

		if (moveEvent.shiftKey && start.w > 0 && start.h > 0) {
			let scale = Math.max(w / start.w, h / start.h);
			w = start.w * scale;
			h = start.h * scale;
		}

		setButtonParam('w', w);
		setButtonParam('h', h);
		setButtonParam('x', start.x + signX * (w - start.w));
		setButtonParam('y', start.y + signY * (h - start.h));
	});
}


function trackPointerDrag(element, startEvent, onMove) {
	let pointerId = startEvent.pointerId;
	let startX = startEvent.clientX;
	let startY = startEvent.clientY;
	let isMoved = false;

	element.setPointerCapture(pointerId);
	element.addEventListener('pointermove', move);
	element.addEventListener('pointerup', end);
	element.addEventListener('pointercancel', end);

	cancelActiveDrag = stop;

	function move(event) {
		if (event.pointerId != pointerId)
			return;

		let dx = event.clientX - startX;
		let dy = event.clientY - startY;

		if (!isMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX)
			return;

		isMoved = true;
		suppressRectClick = true;
		onMove(dx, dy, event);
	}

	function end(event) {
		if (event.pointerId == pointerId)
			stop();
	}

	function stop() {
		element.removeEventListener('pointermove', move);
		element.removeEventListener('pointerup', end);
		element.removeEventListener('pointercancel', end);
		cancelActiveDrag = null;
		removeSnapGuides();

		if (isMoved)
			commitHistory();
	}
}


function setButtonParam(section, value) {
	let rounded = Number(value.toFixed(5));
	applyButtonParam(section, rounded);
	document.getElementById(section + '-number').value = rounded;
	document.getElementById(section + '-range').value = rounded;
}


function showResizeHandles(rect) {
	removeResizeHandles();

	[[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([signX, signY]) => {
		let handle = document.createElement('DIV');
		handle.classList.add('resize-handle');
		handle.classList.add(signX == signY ? 'resize-handle--nwse' : 'resize-handle--nesw');
		handle.style.left = signX < 0 ? '0' : '100%';
		handle.style.top = signY < 0 ? '0' : '100%';

		handle.addEventListener('mousedown', e => {
			e.stopPropagation();
			e.preventDefault();
		});
		handle.addEventListener('pointerdown', e => onResizeHandlePointerDown(e, rect, signX, signY));

		rect.appendChild(handle);
	});
}


function removeResizeHandles() {
	document.querySelectorAll('.resize-handle').forEach(e => e.remove());
}


function createPadBackground() {
	let backgroundDiv = document.createElement('DIV');
	backgroundDiv.classList.add('screenpad-background');

	let bg = conf.getCurrentOverlayBackground();
	if (images[bg.image]) {
		backgroundDiv.style['background-image'] = 'url(' + images[bg.image] + ')';
	}

	if (bg.position) {
		backgroundDiv.style.left = (bg.position.x * 100) + '%';
		backgroundDiv.style.top = (bg.position.y * 100) + '%';
		backgroundDiv.style.width = (bg.position.w * 100) + '%';
		backgroundDiv.style.height = (bg.position.h * 100) + '%';
	}

	let padFrame;
	if (bg.fullscreen)
		padFrame = document.getElementById('screenpad');
	else
		padFrame = document.getElementById('game-screenshot');

	padFrame.appendChild(backgroundDiv);

	let startX = 0;
	let startY = 0;
	let isMouseDown = false;

	let select = document.createElement('DIV');
	select.classList.add('selection-box');
	backgroundDiv.appendChild(select);

	let padContianer = document.getElementById('gamepad-container');
	padContianer.onmouseup = cancelSelection;
	padContianer.onpointerleave = cancelSelection;

	function cancelSelection() {
		select.style.display = 'none';
		isMouseDown = false;

		let indexes = conf.getSelectedIndexes();
		if (indexes.length == 0 && conf.getCurrentLineSectionValue('shape') === null)
			enableEditor(false);

		if (indexes.length == 1) {
			let index = indexes[0];
			conf.resetGroupSelection();
			conf.setCurrentLine(index);
			selectRect(document.querySelector('.rect[data-line-index="' + index + '"]'), index);
		}
	}

	backgroundDiv.onmousedown = (event) => {
		if (event.button != 0)
			return;

		// Text field in inspector must commit its value before selection is changed
		document.activeElement.blur();

		let bgRect = backgroundDiv.getBoundingClientRect();
		let tx = bgRect.left;
		let ty = bgRect.top;
		startX = event.clientX - tx;
		startY = event.clientY - ty;

		isMouseDown = true;
		selectionBeforeMouseDown = getSelectedLines();
		deselectAll();
		conf.setCurrentLine(-1);
		currentRect = null;
		event.preventDefault();
	}

	padContianer.onmousemove = (event) => {
		if (event.buttons != 1 || !isMouseDown)
			return;

		select.style.display = 'block';

		let bgRect = backgroundDiv.getBoundingClientRect();
		let tx = bgRect.left;
		let ty = bgRect.top;

		let endX = event.clientX - tx;
		let endY = event.clientY - ty;


		setControls(startX, startY, endX, endY);
	}

	// empty event listener (fix for old FF)
	document.getElementById('editor').ontouchstart = () => { };

	backgroundDiv.ontouchstart = (event) => {
		let touches = event.touches;
		if (touches.length != 2) {
			select.style.display = 'none';
			return;
		}

		if (cancelActiveDrag)
			cancelActiveDrag();

		select.style.display = 'block';

		let bgRect = backgroundDiv.getBoundingClientRect();
		let tx = bgRect.left;
		let ty = bgRect.top;

		let startX = touches[0].clientX - tx;
		let startY = touches[0].clientY - ty;

		let endX = touches[1].clientX - tx;
		let endY = touches[1].clientY - ty;

		setControls(startX, startY, endX, endY);
	}

	function setControls(sX, sY, eX, eY) {
		let left = Math.min(sX, eX);
		let top = Math.min(sY, eY);
		let right = (backgroundDiv.clientWidth - Math.max(sX, eX));
		let bottom = (backgroundDiv.clientHeight - Math.max(sY, eY));

		select.style.left = left + 'px';
		select.style.top = top + 'px';
		select.style.right = right + 'px';
		select.style.bottom = bottom + 'px';

		getButtonsInRect(left, top, right, bottom, backgroundDiv);
		setEditorControls();
	}

	return backgroundDiv;
}


function getButtonsInRect(left, top, right, bottom, container) {
	let bgRect = container.getBoundingClientRect();
	let cWidth = bgRect.width;
	let cHeight = bgRect.height;

	let rectLeft = left / cWidth;
	let rectTop = top / cHeight;
	let rectRight = (cWidth - right) / cWidth;
	let rectBottom = (cHeight - bottom) / cHeight;

	let indexes = conf.selectButtonsInBounds(rectLeft, rectTop, rectRight, rectBottom);

	let rects = document.querySelectorAll('.rect');
	rects.forEach(e => e.classList.remove('selected'));
	removeResizeHandles();

	indexes.forEach((e) => {
		let elem = document.querySelectorAll('.rect[data-line-index="' + e + '"]');
		if (elem[0])
			elem[0].classList.add('selected');
	});
}


function syncSelectedButtons() {
	let indexes = conf.getSelectedIndexes();

	indexes.forEach((e) => {
		let elem = document.querySelectorAll('.rect[data-line-index="' + e + '"]');
		if (elem[0]) {
			currentRect = elem[0];
			conf.setCurrentLine(e);
			updateCurrentLine(null);
		}
	});
}


function deselectAll() {
	let rects = document.querySelectorAll('.rect');
	rects.forEach(e => e.classList.remove('selected'));
	removeResizeHandles();
	conf.resetGroupSelection();
}


function setEditorControls() {
	enableEditor(false);
	let size = conf.getSelectionDimensions();
	if (size)
		enableEditorSliders(true);
	else
		return;

	'xywh'.split('').forEach(elem => {
		let range = document.getElementById(elem + '-range');
		let text = document.getElementById(elem + '-number');
		text.value = Number(size[elem].toFixed(10));
		range.value = size[elem];
	});
}


function loadConfigFromFile(e) {
	let file = e.target.files[0];
	if (!file)
		return;

	readConfigFile(file, () => {
		e.target.value = '';
	});
}


function readConfigFile(file, onError) {
	let reader = new FileReader();
	reader.onload = function (ev) {
		let previousConfig = conf.getConfigString();
		let previousSaved = savedConfigStr;

		try {
			renderConfig(ev.target.result);
			configStr = ev.target.result;
			importedFilename = file.name;
			resetExportFilename();
			showToast('Opened ' + file.name);
		} catch {
			showToast('Could not read this file.\nYour previous config is still here.');
			renderConfig(previousConfig, true);
			savedConfigStr = previousSaved;

			if (onError)
				onError();
		}
	};
	reader.readAsText(file);
}


function renderConfig(str, keepHistory) {
	conf.convertCfgToArray(str, () => {
		buildAndSetOverlaySelectors(0);

		screen.isPortrait = -1 != conf.getOverlayList()[0].search('portrait');
		document.getElementById('chk-show-portrait').checked = screen.isPortrait;

		setScreenDimensions();
		redrawPad();
		savedConfigStr = conf.getConfigString();

		if (!keepHistory)
			resetHistory();

		updateDocStatus();
	},
		images);
}


function loadImageFiles(e) {
	readImageFiles(e.target.files);
}


function onFileDragOver(event) {
	if (pendingSession || !event.dataTransfer.types.includes('Files'))
		return;

	event.preventDefault();
	document.body.classList.add('is-file-dragging');
}


function onFileDrop(event) {
	document.body.classList.remove('is-file-dragging');

	if (pendingSession || event.dataTransfer.files.length == 0)
		return;

	event.preventDefault();

	let files = Array.from(event.dataTransfer.files);
	let config = files.find(f => /\.cfg$/i.test(f.name));
	let imageFiles = files.filter(f => /\.(png|jpe?g)$/i.test(f.name));

	if (imageFiles.length > 0)
		readImageFiles(imageFiles);

	if (config)
		readConfigFile(config);
}


function readImageFiles(files) {
	let imgCounter = 0;
	let loadCounter = 0;

	for (let i = 0; i < files.length; i++) {
		let file = files[i];

		if (!file || !/\.(png|jpe?g)$/i.test(file.name))
			continue;

		imgCounter++;
		let name = file.name;

		let reader = new FileReader();

		reader.onload = function (ev) {
			images[name] = ev.target.result;

			if (!userImages.includes(name)) {
				userImages.push(name);
			}

			// onload is async function so loop ends BEFORE it's first launch
			if (++loadCounter == imgCounter) {
				redrawKeepingSelection();
				fillImagePicker();
				scheduleAutosave();
			}
		};

		reader.readAsDataURL(file);
	}
}


function loadScreenshotFile(e) {
	let file = e.target.files[0];
	if (!file)
		return;

	let reader = new FileReader();

	reader.onload = function (ev) {
		screen.shotImage = ev.target.result;
		screen.shotShow = true;
		refreshScreenshot();

		//get image dimensions;
		if (screen.shotImage) {
			let im = document.createElement('IMG');
			im.onload = function () {
				screen.shotWidth = im.naturalWidth;
				screen.shotHeight = im.naturalHeight;

				setScreenDimensions();
				redrawPad();
			}
			im.src = screen.shotImage;
		}
	}

	reader.readAsDataURL(file);
}


function refreshScreenshot() {
	let shot = document.getElementById('game-screenshot');

	let screenCheckbox = document.getElementById('chk-show-screenshot')
	screenCheckbox.checked = screen.shotShow;
	screenCheckbox.disabled = !screen.shotImage;

	if (screen.shotShow && screen.shotImage)
		shot.style['background-image'] = 'url(' + screen.shotImage + ')';
	else
		shot.style['background-image'] = 'none';
}


function createRect(target, name, x, y, w, h, pct) {
	let rect = document.createElement('DIV');
	let label = document.createElement('SPAN');
	label.classList.add('rect__label');
	label.textContent = name;
	rect.appendChild(label);
	rect.classList.add('rect');

	if (pct) {
		// visualize thumbstick saturate_pct property
		let inner = document.createElement('DIV');
		inner.classList.add('stick-range');
		let perc = Math.round(pct * 70);
		inner.style['background-image'] = 'radial-gradient(transparent, rgba(100,100,200,0.4) ' + perc + '%, transparent ' + (perc + 1) + '%)';
		rect.appendChild(inner);
	}

	let bw = 100 * w * 2;
	let bh = 100 * h * 2;

	let bx = 100 * x - bw / 2;
	let by = 100 * y - bh / 2;

	rect.style.left = bx + '%';
	rect.style.top = by + '%';

	rect.style.width = bw + '%';
	rect.style.height = bh + '%';

	target.appendChild(rect);
	return rect;
}


function redrawPad() {
	resetScreen();
	refreshScreenshot();
	createPadView();
	enableEditor(false);
	commitHistory();
}


function commitHistory() {
	let current = conf.getConfigString();
	if (current == historyCurrentStr)
		return;

	undoStack.push(historyCurrentStr);
	if (undoStack.length > HISTORY_LIMIT)
		undoStack.shift();

	redoStack.length = 0;
	historyCurrentStr = current;
	updateHistoryButtons();
	scheduleAutosave();
}


function resetHistory() {
	undoStack.length = 0;
	redoStack.length = 0;
	historyCurrentStr = conf.getConfigString();
	updateHistoryButtons();
	scheduleAutosave();
}


function undo() {
	if (undoStack.length == 0)
		return;

	redoStack.push(historyCurrentStr);
	applyHistoryState(undoStack.pop());
}


function redo() {
	if (redoStack.length == 0)
		return;

	undoStack.push(historyCurrentStr);
	applyHistoryState(redoStack.pop());
}


function applyHistoryState(str) {
	historyCurrentStr = str;
	conf.restoreConfigString(str);
	currentRect = null;

	buildAndSetOverlaySelectors(conf.getCurrentOverlay());
	setScreenDimensions();
	redrawPad();
	updateHistoryButtons();
	scheduleAutosave();
}


function scheduleAutosave() {
	if (!isAutosaveReady)
		return;

	clearTimeout(autosaveTimer);
	autosaveTimer = setTimeout(flushAutosave, AUTOSAVE_DELAY_MS);
}


function flushPendingAutosave() {
	if (autosaveTimer)
		flushAutosave();
}


function flushAutosave() {
	clearTimeout(autosaveTimer);
	autosaveTimer = null;

	let config = conf.getConfigString();
	if (config == savedConfigStr) {
		sessionStore.clear().catch(console.error);
		return;
	}

	let sessionImages = {};
	userImages.forEach(name => { sessionImages[name] = images[name] });

	sessionStore.save({
		config: config,
		baseConfig: configStr,
		savedConfig: savedConfigStr,
		filename: importedFilename,
		overlay: conf.getCurrentOverlay(),
		images: sessionImages,
		screen: {
			_width: screen._width,
			_height: screen._height,
			isSetByUser: screen.isSetByUser,
		},
	}).catch(console.error);
}


function checkForSavedSession() {
	sessionStore.load().then(session => {
		if (session) {
			pendingSession = session;
			showDialog('session-restore-dialog', true);
		} else {
			isAutosaveReady = true;
		}
	}).catch(err => {
		console.error(err);
		isAutosaveReady = true;
	});
}


function restoreSession() {
	showDialog('session-restore-dialog', false);

	let session = pendingSession;
	pendingSession = null;
	isAutosaveReady = true;

	try {
		Object.assign(images, session.images);
		userImages = Object.keys(session.images);

		Object.assign(screen, session.screen);
		configStr = session.baseConfig;
		importedFilename = session.filename;

		renderConfig(session.config);
		savedConfigStr = session.savedConfig;

		buildAndSetOverlaySelectors(session.overlay);
		setScreenDimensions();
		redrawPad();
		resetExportFilename();
		scheduleAutosave();
	} catch (err) {
		console.error(err);
		showToast('Can not restore previous work.');

		configStr = defaultConfigString;
		importedFilename = 'retropad.cfg';
		renderConfig(configStr);
		sessionStore.clear().catch(console.error);
	}
}


function discardSession() {
	showDialog('session-restore-dialog', false);

	pendingSession = null;
	isAutosaveReady = true;
	sessionStore.clear().catch(console.error);
}


function updateHistoryButtons() {
	document.getElementById('undo-button').disabled = undoStack.length == 0;
	document.getElementById('redo-button').disabled = redoStack.length == 0;
	updateDocStatus();
}


function updateDocStatus() {
	let status = document.getElementById('doc-status');
	let isUnsaved = conf.getConfigString() != savedConfigStr;

	document.getElementById('doc-name').textContent = importedFilename;
	status.textContent = isUnsaved ? 'Not exported' : '';
	status.classList.toggle('is-unsaved', isUnsaved);
}


function redrawKeepingSelection() {
	let lines = getSelectedLines();
	redrawPad();
	applySelection(lines);
}


function resetScreen() {
	let s = document.getElementById('screenpad');
	s.innerHTML = '';

	let d = document.createElement('DIV');
	d.classList.add('inner');
	d.id = 'game-screenshot'
	s.appendChild(d);

	updateScreenSize();
}


function updateScreenSize() {
	let s = document.getElementById('screenpad');
	let d = document.getElementById('game-screenshot');

	if (isZoomFit)
		screen.zoom = getFitZoom();

	document.getElementById('zoom-value').textContent = Math.round(screen.zoom * 100) + '%';
	document.getElementById('status-size').textContent = screen.enteredWidth + ' \u00d7 ' + screen.enteredHeight;
	document.getElementById('orientation-label').textContent = screen.isPortrait ? 'Portrait' : 'Landscape';

	s.style.width = screen.width + 'px';
	s.style.height = screen.height + 'px';

	let shotWidth = screen.shotFrameWidth * screen.zoom;
	let shotHeight = screen.shotFrameHeight * screen.zoom;

	d.style.width = shotWidth + 'px';
	d.style.height = shotHeight + 'px';

	d.style.left = (screen.width - shotWidth) / 2 + 'px';

	if (screen.isPortrait)
		d.style.top = 0;
	else
		d.style.top = (screen.height - shotHeight) / 2 + 'px';

	keepLabelsOnScreen();
}


function setZoom(value) {
	isZoomFit = false;
	screen.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
	updateScreenSize();
	savePreferences();
}


function fitZoom() {
	isZoomFit = true;
	updateScreenSize();
	savePreferences();
}


function getFitZoom() {
	let container = document.getElementById('gamepad-container');
	let padding = parseFloat(getComputedStyle(document.getElementById('gamepad-container__scroll-frame')).paddingLeft) * 2;
	let width = (container.clientWidth - padding - 1) / screen.enteredWidth;
	let height = (container.clientHeight - padding - 1) / screen.enteredHeight;

	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(width, height))) || 1;
}


function changeZoom(direction) {
	setZoom(direction > 0 ? screen.zoom * ZOOM_FACTOR : screen.zoom / ZOOM_FACTOR);
}


function onCanvasWheel(event) {
	if (!event.ctrlKey && !event.metaKey)
		return;

	event.preventDefault();
	changeZoom(event.deltaY < 0 ? 1 : -1);
}


function onCanvasPanStart(event) {
	if (event.button != 1 && !(event.button == 0 && isSpaceHeld))
		return;

	event.preventDefault();
	event.stopPropagation();

	let container = document.getElementById('gamepad-container');
	let startX = event.clientX;
	let startY = event.clientY;
	let startLeft = container.scrollLeft;
	let startTop = container.scrollTop;

	container.classList.add('is-panning');
	container.setPointerCapture(event.pointerId);
	container.addEventListener('pointermove', move);
	container.addEventListener('pointerup', end);
	container.addEventListener('pointercancel', end);

	function move(e) {
		container.scrollLeft = startLeft - (e.clientX - startX);
		container.scrollTop = startTop - (e.clientY - startY);
	}

	function end() {
		container.classList.remove('is-panning');
		container.removeEventListener('pointermove', move);
		container.removeEventListener('pointerup', end);
		container.removeEventListener('pointercancel', end);
	}
}


function setScreenDimensions(width, height, screenshotWidth, screenshotHeight) {
	screen.width = width;
	screen.height = height;

	let ratio = 16 / 9;
	let aspect = conf.getOverlayAspectRatio();
	if (aspect)
		ratio = aspect.w / aspect.h

	// Reverse ratio if it does not match overlay name or orientation checkbox
	if ((screen.isPortrait && ratio > 1) ||
		(!screen.isPortrait && ratio < 1))
		ratio = 1 / ratio;

	if (!screen.isSetByUser)
		if (screen.isPortrait) {
			screen.width = DEF_HEIGHT;
			screen.height = Math.round(DEF_HEIGHT / ratio);
		} else {
			screen.height = DEF_HEIGHT;
			screen.width = Math.round(DEF_HEIGHT * ratio);
		}

	// Swap sides if height > width
	let ewidth = screen.enteredWidth;
	let eheight = screen.enteredHeight;

	let sw = Number(screenshotWidth || screen.shotFrameWidth || DEF_SCR_WIDTH);
	let sh = Number(screenshotHeight || screen.shotFrameHeight || DEF_SCR_HEIGHT);

	if (screen.shotImage && screen.shotShow) {
		switch (screen.shotMode) {
			case 'match':
				sw = screen.shotWidth;
				sh = screen.shotHeight;
				break;

			case 'fit':
				if (ewidth / eheight > screen.shotWidth / screen.shotHeight) {
					sw = eheight * (screen.shotWidth / screen.shotHeight);
					sh = eheight;
				} else {
					sw = ewidth;
					sh = ewidth / (screen.shotWidth / screen.shotHeight);
				}
		}
	} else if (screen.shotMode == 'fit') {
		if (ewidth / eheight > sw / sh) {
			sw = eheight * (sw / sh);
			sh = eheight;
		} else {
			sh = ewidth / (sw / sh);
			sw = ewidth;
		}
	}

	screen.shotFrameWidth = sw;
	screen.shotFrameHeight = sh;
}


function applyScreenDimensions() {
	let w = document.getElementById('display-width').value || screen.longSide;
	let h = document.getElementById('display-height').value || screen.shortSide;
	let sw = document.getElementById('screenshot-width').value;
	let sh = document.getElementById('screenshot-height').value;

	let fit = document.getElementById('radio-screenshot-fit').checked;
	let match = document.getElementById('radio-screenshot-match').checked;
	let setSize = document.getElementById('radio-screenshot-set').checked;

	screen.isSetByUser = true;
	screen.shotMode = fit ? 'fit' : match ? 'match' : setSize ? 'set' : 'fit';

	setScreenDimensions(w, h, sw, sh);

	redrawPad();
	savePreferences();
}


function exportConfig() {
	let configText = conf.getConfigString();
	let file = new Blob([configText], { type: 'text/plain' });
	let name = getExportFilename();
	downloadBlob(file, name);

	savedConfigStr = configText;
	updateDocStatus();
	scheduleAutosave();
	showToast('Saved ' + name);
}


async function exportZip() {
	let configText = conf.getConfigString();
	let configName = getExportFilename();
	let files = [{ name: configName, bytes: new TextEncoder().encode(configText) }];
	let missing = [];

	for (let name of conf.getUsedImages()) {
		try {
			let response = await fetch(images[name]);
			if (!response.ok)
				throw new Error(response.status);

			files.push({ name: name, bytes: new Uint8Array(await response.arrayBuffer()) });
		} catch {
			missing.push(name);
		}
	}

	let zipName = configName.replace(/\.cfg$/i, '') + '.zip';
	downloadBlob(createZipBlob(files), zipName);

	savedConfigStr = configText;
	updateDocStatus();
	scheduleAutosave();

	if (missing.length > 0)
		showToast('Saved ' + zipName + ', without these images:\n' + missing.join('\n'));
	else
		showToast('Saved ' + zipName);
}


function showConfigTextDialog() {
	document.getElementById('config-text').value = conf.getConfigString();
	showDialog('config-text-dialog', true);
}


function applyConfigText() {
	let text = document.getElementById('config-text').value;

	let error = conf.findConfigTextError(text);
	if (error !== null) {
		showToast('Error in config text:\n' + error);
		return;
	}

	let previousConfig = conf.getConfigString();
	let previousSaved = savedConfigStr;
	let overlay = conf.getCurrentOverlay();

	try {
		renderConfig(text, true);
		savedConfigStr = previousSaved;
		currentRect = null;
		buildAndSetOverlaySelectors(overlay);
		setScreenDimensions();
		redrawPad();
		updateDocStatus();
		showDialog('config-text-dialog', false);
	} catch {
		showToast('Error in config text.\nYour previous config is still here.');
		renderConfig(previousConfig, true);
		savedConfigStr = previousSaved;
	}
}


function fillTemplateSelector() {
	let grid = document.getElementById('template-grid');

	padTemplates.concat({ id: 'retropad', name: 'Full RetroPad', config: defaultConfigString }).forEach(template => {
		let tile = document.createElement('BUTTON');
		tile.classList.add('template-tile');
		tile.appendChild(createTemplatePreview(template.config));
		tile.appendChild(document.createTextNode(template.name));
		tile.addEventListener('click', () => loadTemplate(template));
		grid.appendChild(tile);
	});
}


// Draws buttons of first overlay
function createTemplatePreview(config) {
	let preview = document.createElement('SPAN');
	preview.classList.add('template-preview');

	let lines = config.split('\n');

	lines.forEach(line => {
		let match = line.match(/^overlay0_desc(\d+) = "[^,]+,([\d.]+),([\d.]+),\w+,([\d.]+),([\d.]+)"/);
		if (!match)
			return;

		let imageLine = lines.find(l => l.startsWith('overlay0_desc' + match[1] + '_overlay = '));
		if (!imageLine)
			return;

		let [x, y, w, h] = match.slice(2).map(Number);
		let image = document.createElement('IMG');
		image.src = images[imageLine.split('= ')[1].replace(/"/g, '')];
		image.alt = '';
		image.loading = 'lazy';
		image.style.left = (x - w) * 100 + '%';
		image.style.top = (y - h) * 100 + '%';
		image.style.width = w * 200 + '%';
		image.style.height = h * 200 + '%';
		preview.appendChild(image);
	});

	return preview;
}


function loadTemplate(template) {
	showDialog('template-dialog', false);

	currentRect = null;
	renderConfig(template.config, true);
	configStr = template.config;
	importedFilename = template.id + '.cfg';
	resetExportFilename();
	showToast('Started from ' + template.name, 'Undo', undo);
}


function showExportDialog() {
	if (!document.getElementById('export-filename').value)
		resetExportFilename();

	fillCheckResults(conf.getConfigProblems(images), conf.getHitAreaOverlaps());
	showDialog('export-dialog', true);
}


function hideExportDialog() {
	showDialog('export-dialog', false);
}


function fillCheckResults(problems, notes) {
	let summary = document.getElementById('check-summary');
	summary.classList.toggle('has-problems', problems.length > 0);

	if (problems.length == 0)
		summary.textContent = 'Ready for RetroArch';
	else
		summary.textContent = problems.length + (problems.length == 1 ? ' problem' : ' problems') + ' to look at. You can still export.';

	let fillList = (id, rows) => {
		let list = document.getElementById(id);
		list.innerHTML = '';

		rows.forEach(text => {
			let row = document.createElement('LI');
			row.textContent = text;
			list.appendChild(row);
		});
	};

	fillList('check-list', problems);
	fillList('check-notes', notes);

	document.getElementById('check-notes-box').classList.toggle('hidden', notes.length == 0);
	document.getElementById('check-notes-summary').textContent = notes.length + (notes.length == 1 ? ' touch area overlaps' : ' touch areas overlap') + ' (usually fine)';
}


function downloadBlob(blob, filename) {
	let a = document.createElement('A');
	a.href = URL.createObjectURL(blob);
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 0);
}


function getDefaultExportFilename() {
	return 'new-' + importedFilename.replace(/^new-/, '');
}


function resetExportFilename() {
	document.getElementById('export-filename').value = getDefaultExportFilename();
	updateDocStatus();
}


function getExportFilename() {
	let name = document.getElementById('export-filename').value.trim().replace(/[\\/:*?"<>|]/g, '');
	if (!name)
		return getDefaultExportFilename();

	return /\.cfg$/i.test(name) ? name : name + '.cfg';
}


function updateCurrentLine(section, value) {
	if (conf.getCurrentLineSectionValue('shape') === null)
		return;

	if (section)
		conf.setCurrentLineSectionValue(section, value);

	let rw = 100 * conf.getCurrentLineSectionValue('w') * 2;
	let rh = 100 * conf.getCurrentLineSectionValue('h') * 2;

	let rx = 100 * conf.getCurrentLineSectionValue('x') - rw / 2;
	let ry = 100 * conf.getCurrentLineSectionValue('y') - rh / 2;

	if (currentRect) {
		currentRect.style.height = rh + '%';
		currentRect.style.width = rw + '%';
		currentRect.style.left = rx + '%';
		currentRect.style.top = ry + '%';
		keepLabelsOnScreen();
	}
}


function buildAndSetOverlaySelectors(selectIndex) {
	let list = conf.getOverlayList();

	selectIndex = Math.min(selectIndex, list.length - 1);
	conf.setCurrentOverlay(selectIndex);
	screen.isPortrait = list[selectIndex].search('portrait') != -1;

	document.getElementById('chk-show-portrait').checked = screen.isPortrait;

	updateOverlayList();

	let selectNext = document.getElementById('next_target_property');
	selectNext.innerHTML = '';

	let none = document.createElement('OPTION');
	none.value = '';
	none.textContent = 'None';
	selectNext.appendChild(none);

	for (let i = 0; i < list.length; i++) {
		if (list[i]) {
			let o = document.createElement('OPTION');
			o.value = list[i];
			o.textContent = list[i].replace(/"/g, '');
			selectNext.appendChild(o);
		}
	}
}


function updateOverlayList() {
	let container = document.getElementById('overlay-list');
	let current = conf.getCurrentOverlay();
	container.innerHTML = '';

	conf.getOverlayList().forEach((item, index) => {
		let name = item.replace(/"/g, '') || 'Unnamed';

		let row = document.createElement('LI');
		row.classList.toggle('selected', index == current);

		let main = document.createElement('BUTTON');
		main.classList.add('row-main');
		main.addEventListener('click', () => switchOverlay(index));
		if (index == current)
			main.setAttribute('aria-current', 'true');

		let shape = document.createElement('SPAN');
		shape.classList.add('row-orientation');
		shape.classList.toggle('row-orientation--portrait', item.search('portrait') != -1);

		let text = document.createElement('SPAN');
		text.classList.add('row-main__text');
		text.textContent = name;

		main.appendChild(shape);
		main.appendChild(text);
		row.appendChild(main);
		container.appendChild(row);
	});
}


function fillButtonEditor(command, shape, image, addLines) {
	document.getElementById('command-name').value = command;
	document.getElementById(shape == 'rect' ? 'shape-rect' : 'shape-radial').checked = true;
	document.getElementById('image-name').value = image || '';

	showImagePreview(image);
	setCommandSelectorOption(command);
	fillAdditionalPropsFields(addLines.split('\n'));
	updateAdditionalPropsVisibility(command);
}


function updateInspector(isEnabled) {
	let mode = !isEnabled ? 'overlay' : conf.isGroupSelected() ? 'multi' : 'single';
	document.getElementById('inspector').dataset.mode = mode;

	let title = document.getElementById('selection-title');

	if (mode == 'overlay') {
		fillOverlayFields();
	} else if (mode == 'multi') {
		let count = conf.getSelectedIndexes().length;
		title.textContent = count + (count == 1 ? ' button selected' : ' buttons selected');
	} else {
		let values = conf.getCurrentButtonParams();
		title.textContent = 'Button';
		fillButtonEditor(values.command, values.shape, values.image, values.addLines.join('\n'));
	}
}


function fillOverlayFields() {
	let current = conf.getCurrentOverlay();
	let count = conf.getOverlayList().length;

	document.getElementById('overlay-current-name').value = conf.getCurrentOverlayName();
	document.getElementById('raw-overlay-current').value = conf.getCurrentOverlayParams().join('\n');
	document.getElementById('overlay-move-up').disabled = current == 0;
	document.getElementById('overlay-move-down').disabled = current == count - 1;
	document.getElementById('overlay-delete').disabled = count <= 1;

	document.getElementById('display-width').value = screen.longSide;
	document.getElementById('display-height').value = screen.shortSide;

	let preset = document.getElementById('device-preset');
	preset.value = screen.longSide + 'x' + screen.shortSide;
	if (preset.selectedIndex == -1)
		preset.value = '';

	document.getElementById('screenshot-width').value = +Number(screen.shotFrameWidth).toFixed(2);
	document.getElementById('screenshot-height').value = +Number(screen.shotFrameHeight).toFixed(2);
	document.getElementById('radio-screenshot-' + screen.shotMode).checked = true;
	document.getElementById('radio-screenshot-match').disabled = !screen.shotImage || !screen.shotShow;

	onScreenshotModeChange();
}


function applyButtonEdit() {
	let d = getButtonDataFromDialog();

	if (d.warn) {
		updateInspector(true);
		return;
	}

	conf.updateCurrentButton(d.command, d.shape, d.image, d.lines);
	redrawKeepingSelection();
}


function getOverlayNameError(name) {
	if (name == '')
		return 'Enter a name for the overlay.';

	if (/["=]/.test(name))
		return 'Overlay names can not contain " or =.';

	if (conf.getCurrentOverlayName() != name && conf.isOverlayNameExist(name))
		return 'Another overlay already has this name.';

	return null;
}


function applyOverlayEdit() {
	let name = document.getElementById('overlay-current-name').value.trim();
	let error = getOverlayNameError(name);

	if (error) {
		showToast(error);
		fillOverlayFields();
		return;
	}

	conf.editCurrentOverlay(name, processRawProperties(document.getElementById('raw-overlay-current').value));

	buildAndSetOverlaySelectors(conf.getCurrentOverlay());
	setScreenDimensions();
	redrawPad();
}


function showImagePicker() {
	document.getElementById('image-picker-filter').value = '';
	fillImagePicker();
	showDialog('image-picker-dialog', true);
}


function fillImagePicker() {
	let filter = document.getElementById('image-picker-filter').value.trim().toLowerCase();
	let grid = document.getElementById('image-picker-grid');
	grid.innerHTML = '';

	let names = userImages.concat(Object.keys(images).filter(name => !userImages.includes(name)));

	if (filter == '') {
		let none = document.createElement('BUTTON');
		none.classList.add('tile');

		let mark = document.createElement('SPAN');
		mark.classList.add('tile__thumb', 'tile__thumb--empty');
		mark.textContent = 'none';

		none.appendChild(mark);
		none.appendChild(document.createTextNode('No image'));
		none.addEventListener('click', () => chooseImage(''));
		grid.appendChild(none);
	}

	names.filter(name => name.toLowerCase().includes(filter)).forEach(name => {
		let button = document.createElement('BUTTON');
		button.classList.add('tile');

		let thumbnail = document.createElement('IMG');
		thumbnail.classList.add('tile__thumb');
		thumbnail.src = images[name];
		thumbnail.alt = '';
		thumbnail.loading = 'lazy';

		button.appendChild(thumbnail);
		button.appendChild(document.createTextNode(name));
		button.addEventListener('click', () => chooseImage(name));
		grid.appendChild(button);
	});
}


function chooseImage(name) {
	document.getElementById('image-name').value = name;
	showImagePreview(name);
	showDialog('image-picker-dialog', false);
	applyButtonEdit();
}


function fillCommandSelector(groups) {
	let s = document.getElementById('command-select');

	groups.forEach((group) => {
		let g = document.createElement('OPTGROUP');
		g.label = group.label;

		group.commands.forEach(([command, name]) => {
			let o = document.createElement('OPTION');
			o.value = command;
			o.appendChild(document.createTextNode(name));
			g.appendChild(o);
		});

		s.appendChild(g);
	});

	let custom = document.createElement('OPTION');
	custom.value = CUSTOM_COMMAND;
	custom.textContent = 'Custom command\u2026';
	s.appendChild(custom);
}


function fillAddButtonDialog() {
	let container = document.getElementById('add-button-groups');

	buttonCommandGroups.forEach(group => {
		let heading = document.createElement('DIV');
		heading.classList.add('tile-grid-heading');
		heading.textContent = group.label;
		container.appendChild(heading);

		let grid = document.createElement('DIV');
		grid.classList.add('tile-grid');

		group.commands.forEach(([command, name]) => {
			grid.appendChild(createAddButtonTile(name, buttonCommandImages[command], () => addButton(command)));
		});

		container.appendChild(grid);
	});

	let custom = document.createElement('DIV');
	custom.classList.add('tile-grid');
	custom.appendChild(createAddButtonTile('Custom command', null, () => addButton('custom', true)));

	let heading = document.createElement('DIV');
	heading.classList.add('tile-grid-heading');
	heading.textContent = 'Other';
	container.appendChild(heading);
	container.appendChild(custom);
}


function createAddButtonTile(name, image, onClick) {
	let tile = document.createElement('BUTTON');
	tile.classList.add('tile');

	if (image) {
		let thumb = document.createElement('IMG');
		thumb.classList.add('tile__thumb');
		thumb.src = images[image];
		thumb.alt = '';
		thumb.loading = 'lazy';
		tile.appendChild(thumb);
	}

	tile.appendChild(document.createTextNode(name));
	tile.addEventListener('click', onClick);
	return tile;
}


function setCommandSelectorOption(value) {
	let s = document.getElementById('command-select');
	s.value = value;

	let isCustom = s.selectedIndex == -1;
	if (isCustom)
		s.value = CUSTOM_COMMAND;

	document.getElementById('command-name').classList.toggle('hidden', !isCustom);
}


function showAdditionalParametersForCommand(command) {
	let parameters = {
		analog_left: 'movable = true\nrange_mod = 2.0\nsaturate_pct = 0.65',
		get analog_right() { return this.analog_left },

		get overlay_next() {
			let list = conf.getOverlayList();
			let current = conf.getCurrentOverlay();

			if (list.length <= 1)
				return '';

			if (current < list.length - 1)
				return 'next_target = ' + list[current + 1]
			else
				return 'next_target = ' + list[0];
		},

		dpad_area: 'range_mod_exclusive = true',
		abxy_area: 'range_mod_exclusive = true',
	}

	return parameters[command];
}


function enableEditor(enable) {
	enableEditorSliders(enable)
}


function enableEditorSliders(enable) {
	let editor = document.getElementById('editor');
	let inputs = editor.querySelectorAll('input,button');
	inputs.forEach(e => { e.disabled = !enable })
	updateButtonListSelection();
	document.getElementById('duplicate-button').disabled = !enable;
	document.getElementById('mirror-button').disabled = !enable;
	document.getElementById('del-current-button').disabled = !enable;
	updateInspector(enable);
}


function fillAdditionalPropsFields(data) {
	clearAdditionalPropsFields();

	if (!Array.isArray(data) || data.length == 0 || data[0] == '')
		return;

	let others = document.getElementById('raw-button-properties');
	let othData = '';

	data.forEach(e => {
		let earr = e.split('=');
		let prop = earr[0].trim();
		let val = earr[1] ? earr[1].trim() : '';
		let fields = [];

		// Overlay names in target list are quoted
		if (prop == 'next_target' && val && !val.startsWith('"'))
			val = '"' + val + '"';

		try {
			fields = document.querySelectorAll('.js-additional-button-property #' + prop + '_property');
		} catch {
			// Property name is not a valid selector, keep it in raw data
		}

		switch (fields.length) {
			case 1:
				fields[0].value = val;
				break;

			case 0:
				othData += e + '\n';
				break;

			default:
		}

	});

	others.value = othData.trim();
}


// Properties that do not apply to command are shown only when they have a value
function updateAdditionalPropsVisibility(command) {
	document.querySelectorAll('.js-additional-button-property[data-commands]').forEach(row => {
		let hasValue = Array.from(row.querySelectorAll('input, select')).some(e => e.value != '');
		row.classList.toggle('hidden', !hasValue && !row.dataset.commands.split(' ').includes(command));
	});
}


function clearAdditionalPropsFields() {
	let v = document.querySelectorAll('.js-additional-button-property input, .js-additional-button-property select');

	v.forEach(e => e.value = '');
	document.getElementById('raw-button-properties').value = '';
}


function readAdditionalPropsFields() {
	let v = document.querySelectorAll('.js-additional-button-property input, .js-additional-button-property select');
	let result = [];

	v.forEach(e => {
		if (e.value != '') {
			let propName = e.id.substr(0, e.id.search(/_property$/));
			result.push(propName + ' = ' + e.value);
		}
	});

	let raw = document.getElementById('raw-button-properties').value;

	return result.concat(processRawProperties(raw));
}


function processRawProperties(str) {
	let arr = str.trim().split('\n');
	let ret = [];

	arr.forEach(e => {
		let line = e.trim();
		if (line == '')
			return;

		let eqPos = line.indexOf('=');

		if (eqPos <= 0) {
			showToast('Error in line "' + line + '"\nProperty removed');
			return;
		}

		let prop = line.substr(0, eqPos).trim();
		let value = line.substr(eqPos + 1).trim();

		ret.push(prop + ' = ' + value);
	});

	return ret;
}


function showDialog(elementId, isShow) {
	let dialog = document.getElementById(elementId);

	if (!dialog)
		return;

	if (isShow) {
		if (dialog.classList.contains('hidden'))
			dialogFocusStack.push({ id: elementId, element: document.activeElement });

		dialog.classList.remove('hidden');
	} else {
		dialog.classList.add('hidden');
		restoreDialogFocus(elementId);
		return;
	}

	let focusCandidates = document.querySelectorAll('#' + elementId + ' .js-dialog__focus');
	let target = focusCandidates.length > 0 ? focusCandidates[0] : getFocusableElements(dialog)[0];
	if (target)
		target.focus();
}


function restoreDialogFocus(elementId) {
	let index = dialogFocusStack.findIndex(e => e.id == elementId);
	if (index == -1)
		return;

	let element = dialogFocusStack.splice(index, 1)[0].element;
	if (element && element.isConnected)
		element.focus();
}


function getFocusableElements(container) {
	let selector = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]';
	return Array.from(container.querySelectorAll(selector)).filter(e => e.offsetParent !== null);
}


function trapDialogFocus(event) {
	if (event.key != 'Tab')
		return;

	let dialogs = document.querySelectorAll('.dialog-container:not(.hidden)');
	if (dialogs.length == 0)
		return;

	let top = dialogs[dialogs.length - 1];
	let focusable = getFocusableElements(top);
	if (focusable.length == 0)
		return;

	let first = focusable[0];
	let last = focusable[focusable.length - 1];
	let active = document.activeElement;

	if (!top.contains(active)) {
		event.preventDefault();
		first.focus();
	} else if (event.shiftKey && active == first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && active == last) {
		event.preventDefault();
		first.focus();
	}
}


function showImagePreview(imgName) {
	let image = images[imgName];
	document.getElementById('image-picker-button').style['background-image'] = image ? 'url(' + image + ')' : 'none';
}


function generateOverlayName(isPortrait) {
	let prefix = isPortrait ? 'portrait' : 'landscape';
	let index = conf.getOverlayList().length + 1;

	while (conf.isOverlayNameExist(prefix + '-' + index)) {
		index++;
	}

	document.getElementById('overlay-name').value = prefix + '-' + index;
}


function closeTopDialogOnEscape(event) {
	if (event.key != 'Escape')
		return;

	// nested dialogs are placed after their parents in markup
	let dialogs = document.querySelectorAll('.dialog-container:not(.hidden)');
	if (pendingSession)
		return;

	if (dialogs.length > 0) {
		showDialog(dialogs[dialogs.length - 1].id, false);
		event.stopImmediatePropagation();
	}
}


function handleShortcuts(event) {
	if (document.querySelector('.dialog-container:not(.hidden)'))
		return;

	if (isTestMode) {
		if (event.key == 'Escape')
			setTestMode(false);
		return;
	}

	if (event.target.matches('input, textarea, select')) {
		if (event.key == 'Escape')
			event.target.blur();
		return;
	}

	let key = event.key.toLowerCase();
	let isCtrl = event.ctrlKey || event.metaKey;

	if (isCtrl) {
		if (key == 'z' && !event.shiftKey)
			undo();
		else if (key == 'y' || key == 'z')
			redo();
		else if (key == 'd')
			duplicateSelection();
		else if (key == 'a')
			applySelection(conf.buildPadFromConfig().map(b => b.i));
		else if (key == 's')
			showExportDialog();
		else
			return;

		event.preventDefault();
		return;
	}

	if (!event.altKey) {
		let handled = true;

		if (key == '+' || key == '=')
			changeZoom(1);
		else if (key == '-')
			changeZoom(-1);
		else if (key == '0')
			fitZoom();
		else if (key == '?')
			showDialog('help-dialog', true);
		else
			handled = false;

		if (handled) {
			event.preventDefault();
			return;
		}
	}

	// Editor is enabled only when buttons are selected
	let isSelected = !document.getElementById('x-number').disabled;
	if (!isSelected)
		return;

	let step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;

	switch (key) {
		case 'arrowleft':
			nudgeSelection('x', -step);
			break;

		case 'arrowright':
			nudgeSelection('x', step);
			break;

		case 'arrowup':
			nudgeSelection('y', -step);
			break;

		case 'arrowdown':
			nudgeSelection('y', step);
			break;

		case 'delete':
		case 'backspace':
			if (!document.getElementById('del-current-button').disabled)
				delCurrentButton();
			break;

		case 'escape':
			deselectAll();
			conf.setCurrentLine(-1);
			currentRect = null;
			enableEditor(false);
			break;

		default:
			return;
	}

	event.preventDefault();
}


function duplicateSelection() {
	if (document.getElementById('duplicate-button').disabled)
		return;

	copySelection((x, y) => ({ x: x + DUPLICATE_OFFSET, y: y + DUPLICATE_OFFSET }));
}


function mirrorSelection() {
	copySelection((x, y) => ({ x: 1 - x, y: y }));
}


function copySelection(getPosition) {
	let created = conf.duplicateSelectedButtons(getPosition);

	if (created.length == 1) {
		conf.resetGroupSelection();
		redrawPad();
		selectRect(document.querySelector('.rect[data-line-index="' + created[0] + '"]'), created[0]);
	} else {
		conf.setSelectedIndexes(created);
		currentRect = null;
		redrawPad();
		setEditorControls();
	}
}


function alignSelection(mode) {
	conf.alignSelection(mode);
	syncSelectedButtons();
	setEditorControls();
	commitHistory();
}


function distributeSelection(axis) {
	conf.distributeSelection(axis);
	syncSelectedButtons();
	setEditorControls();
	commitHistory();
}


function nudgeSelection(section, delta) {
	let group = conf.getSelectionDimensions();
	let value = group ? group[section] : Number(conf.getCurrentLineSectionValue(section));
	setButtonParam(section, value + delta);
}


function warnAboutUnsavedChanges(event) {
	if (conf.getConfigString() == savedConfigStr)
		return;

	event.preventDefault();
	event.returnValue = '';
}


// Inline event listeners

function resetPad() {
	let before = conf.getConfigString();

	currentRect = null;
	renderConfig(configStr, true);

	if (conf.getConfigString() == before)
		showToast('Nothing to revert.');
	else
		showToast('Reverted to the opened version', 'Undo', undo);
}


function pickFile(inputId) {
	let input = document.getElementById(inputId);

	// allow importing same file again (change event is not fired otherwise)
	input.value = '';
	input.click();
}


function toggleShapes(event) {
	let s = document.getElementById('screenpad');

	if (event.target.checked)
		s.classList.add('show-borders');
	else
		s.classList.remove('show-borders');
}


function toggleNames(event) {
	let s = document.getElementById('screenpad');

	if (event.target.checked)
		s.classList.remove('hide-names');
	else
		s.classList.add('hide-names');

	keepLabelsOnScreen();
}


function flipCoord(axis) {
	conf.flipSelection(axis);

	if (conf.isGroupSelected()) {
		syncSelectedButtons();
		setEditorControls();
	} else {
		let value = conf.getCurrentLineSectionValue(axis);
		document.getElementById(axis + '-range').value = value;
		document.getElementById(axis + '-number').value = value;
		updateCurrentLine();
	}

	commitHistory();
}


function normalizeHeight() {
	let h = conf.normalizeHeight(screen.width, screen.height)
	document.getElementById('h-range').value = h;
	document.getElementById('h-number').value = h;
	updateCurrentLine();
	syncSelectedButtons();
	commitHistory();
}


function normalizeWidth() {
	let w = conf.normalizeWidth(screen.width, screen.height)
	document.getElementById('w-range').value = w;
	document.getElementById('w-number').value = w;
	updateCurrentLine();
	syncSelectedButtons();
	commitHistory();
}


function fixAspect() {
	let iw = document.getElementById('initial-aspect-width').value;
	let ih = document.getElementById('initial-aspect-height').value;

	let ow = document.getElementById('target-display-width').value;
	let oh = document.getElementById('target-display-height').value;

	let mode = document.getElementById('chk-keep-relative').checked;

	if (!(iw > 0 && ih > 0 && ow > 0 && oh > 0)) {
		showToast('Enter positive values for all dimensions');
		return;
	}

	conf.fixAspect(iw, ih, ow, oh, screen.isPortrait, mode);

	hideAspectFixer();

	// Do not rescale if aspect ratio has been set instead of target resolution
	if (ow >= 96 && oh >= 64)
		setScreenDimensions(ow, oh);

	deselectAll();
	redrawPad();
}


function getButtonDataFromDialog() {
	let d = {};

	d.command = document.getElementById('command-name').value.trim();
	if (d.command == '' || /[\s,"=]/.test(d.command)) {
		d.warn = true;
		showToast('A command can not be empty or contain spaces, commas, quotes or =.');
	}

	d.shape = document.getElementById('shape-rect').checked ? 'rect' : 'radial';
	d.image = document.getElementById('image-name').value.trim();

	d.lines = readAdditionalPropsFields();

	return d;
}


function addButton(command, isCustom) {
	showDialog('add-button-dialog', false);

	let lines = showAdditionalParametersForCommand(command);
	let shape = /_area$/.test(command) ? 'rect' : 'radial';

	conf.createButton(command, shape, buttonCommandImages[command] || '', lines ? lines.split('\n') : []);

	// New button starts as a visual square
	conf.setCurrentLineSectionValue('h', NEW_BUTTON_HALF_HEIGHT);
	conf.setCurrentLineSectionValue('w', +(NEW_BUTTON_HALF_HEIGHT * screen.enteredHeight / screen.enteredWidth).toFixed(5));

	let line = conf.getCurrentLine();
	currentRect = null;
	redrawPad();
	applySelection([line]);

	if (isCustom) {
		let field = document.getElementById('command-name');
		field.classList.remove('hidden');
		document.getElementById('command-select').value = CUSTOM_COMMAND;
		field.focus();
		field.select();
	}
}


function addOverlay() {
	let name = document.getElementById('overlay-name').value.trim();
	let raw = document.getElementById('raw-overlay-properties').value;
	let errorBox = document.getElementById('overlay-name-error');
	let error = conf.isOverlayNameExist(name) ? 'Another overlay already has this name.' : getOverlayNameError(name);

	errorBox.textContent = error || '';
	errorBox.classList.toggle('hidden', !error);

	if (error) {
		document.getElementById('overlay-name').focus();
		return;
	}

	let props = processRawProperties(raw);

	if (document.getElementById('chk-duplicate-overlay').checked)
		conf.duplicateCurrentOverlay(name, props);
	else
		conf.createOverlay(name, props);

	hideOverlayEditor();
	currentRect = null;
	conf.setCurrentLine(-1);
	buildAndSetOverlaySelectors(1000);
	setScreenDimensions();
	redrawPad();
}


function delCurrentButton() {
	let before = conf.getConfigString();

	if (conf.isGroupSelected())
		conf.deleteSelectedButtons();
	else
		conf.deleteCurrentButton();

	currentRect = null;
	redrawPad();

	if (conf.getConfigString() != before)
		showToast('Deleted', 'Undo', undo);
}


function moveOverlay(direction) {
	if (!conf.moveCurrentOverlay(direction))
		return;

	currentRect = null;
	buildAndSetOverlaySelectors(conf.getCurrentOverlay());
	setScreenDimensions();
	redrawPad();
}


function delCurrentOverlay() {
	let before = conf.getConfigString();

	conf.deleteCurrentOverlay();
	currentRect = null;
	buildAndSetOverlaySelectors(0);
	setScreenDimensions();
	redrawPad();

	if (conf.getConfigString() != before)
		showToast('Overlay deleted', 'Undo', undo);
}


function showButtonCreator() {
	showDialog('add-button-dialog', true);
}


function showOverlayCreator(isCopy) {
	document.getElementById(isCopy ? 'chk-duplicate-overlay' : 'overlay-start-blank').checked = true;
	document.getElementById(screen.isPortrait ? 'chk-portrait-overlay' : 'overlay-orientation-landscape').checked = true;
	document.getElementById('overlay-name-error').classList.add('hidden');

	updateNewOverlayFields();
	showDialog('overlay-create-dialog', true);
}


function hideOverlayEditor() {
	showDialog('overlay-create-dialog', false);
}


function showAspectFixer() {
	let aspect = conf.getOverlayAspectRatio();
	if (aspect) {
		document.getElementById('initial-aspect-width').value = aspect.w;
		document.getElementById('initial-aspect-height').value = aspect.h;
	} else {
		document.getElementById('initial-aspect-width').value = screen.isPortrait ? 9 : 16;
		document.getElementById('initial-aspect-height').value = screen.isPortrait ? 16 : 9;
	}

	let hint = document.getElementById('aspect-hint');
	if (screen.isPortrait)
		hint.classList.remove('hidden');
	else
		hint.classList.add('hidden');

	document.getElementById('target-display-width').value = screen.enteredWidth;
	document.getElementById('target-display-height').value = screen.enteredHeight;
	showDialog('aspect-fixer-dialog', true);
}


function hideAspectFixer() {
	showDialog('aspect-fixer-dialog', false);
}


function applyDevicePreset() {
	let select = document.getElementById('device-preset');
	if (!select.value)
		return;

	let size = select.value.split('x');
	document.getElementById('display-width').value = size[0];
	document.getElementById('display-height').value = size[1];
	applyScreenDimensions();
}


function onScreenshotModeChange() {
	let screenshotWidth = document.getElementById('screenshot-width');
	let screenshotHeight = document.getElementById('screenshot-height');

	let screenshotFit = document.getElementById('radio-screenshot-fit');
	let screenshotMatch = document.getElementById('radio-screenshot-match');

	let disableSizeSet = (screen.shotImage && screen.shotShow) && (screenshotFit.checked || screenshotMatch.checked);
	screenshotWidth.disabled = disableSizeSet;
	screenshotHeight.disabled = disableSizeSet;
}


function fillCommandField(event) {
	let command = event.target.value;
	let field = document.getElementById('command-name');

	if (command == CUSTOM_COMMAND) {
		field.classList.remove('hidden');
		field.focus();
		field.select();
		return;
	}

	field.classList.add('hidden');
	field.value = command;

	clearAdditionalPropsFields();
	let lines = showAdditionalParametersForCommand(command);
	if (lines)
		fillAdditionalPropsFields(lines.split('\n'));

	applyButtonEdit();
}


function toggleOrientation(event) {
	screen.isPortrait = event.target.checked;
	setScreenDimensions();
	redrawPad();
}


function toggleScreenshot(event) {
	screen.shotShow = event.target.checked;
	setScreenDimensions();
	refreshScreenshot();
	redrawPad();
}


function toggleSnap(event) {
	document.getElementById('screenpad').classList.toggle('show-grid', event.target.checked);
}


function toggleOffscreen(event) {
	let screenDiv = document.getElementById('screenpad');

	if (event.target.checked) {
		screenDiv.classList.add('show-offscreen');
		screenDiv.classList.remove('hide-offscreen');
	} else {
		screenDiv.classList.remove('show-offscreen');
		screenDiv.classList.add('hide-offscreen');
	}

	updateScreenSize();
}


function updateNewOverlayFields() {
	let box = document.getElementById('raw-overlay-properties');
	let portraitChk = document.getElementById('chk-portrait-overlay');
	let landscapeChk = document.getElementById('overlay-orientation-landscape');
	let isDuplicate = document.getElementById('chk-duplicate-overlay').checked;

	portraitChk.disabled = isDuplicate;
	landscapeChk.disabled = isDuplicate;

	if (isDuplicate) {
		box.value = conf.getCurrentOverlayParams().join('\n');
		let isCurrentPortrait = conf.getCurrentOverlayName().search('portrait') != -1;
		(isCurrentPortrait ? portraitChk : landscapeChk).checked = true;
	} else {
		let aspect = screen.longSide / screen.shortSide;
		let ratio = 'aspect_ratio = ' + +(portraitChk.checked ? 1 / aspect : aspect).toFixed(7);
		box.value = defaultParamsForNewOverlay + '\n' + ratio;
		box.value += '\n' + autoScaleParams + 'auto_y_separation = ' + (portraitChk.checked ? 'false' : 'true');
		box.value += '\n' + manualScaleParams;
	}

	generateOverlayName(portraitChk.checked);
}


function switchOverlay(index) {
	deselectAll();
	conf.setCurrentOverlay(index);
	conf.setCurrentLine(-1);
	currentRect = null;

	let name = conf.getCurrentOverlayName();

	if (name.search('portrait') != -1)
		screen.isPortrait = true;

	if (name.search('landscape') != -1)
		screen.isPortrait = false;

	document.getElementById('chk-show-portrait').checked = screen.isPortrait;

	updateOverlayList();
	setScreenDimensions();
	redrawPad();
}


function setAppTheme(theme) {
	let isDark = theme == 'dark' || (theme == 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	document.body.classList.toggle('dark', isDark);
	document.querySelector('meta[name=theme-color]').content = isDark ? THEME_COLORS.dark : THEME_COLORS.light;
	document.getElementById('app-theme').value = theme;
	savePreferences();
}


function savePreferences() {
	if (isLoadingPreferences)
		return;

	let checkboxes = {};
	PREFERENCE_CHECKBOXES.forEach(id => { checkboxes[id] = document.getElementById(id).checked });

	let preferences = {
		checkboxes: checkboxes,
		appTheme: document.getElementById('app-theme').value,
		colorScheme: colorSchemeIndex,
		zoom: isZoomFit ? 'fit' : screen.zoom,
		screen: screen.isSetByUser ? { _width: screen._width, _height: screen._height, isSetByUser: true } : null,
	};

	try {
		localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
	} catch {
		// Editor works without saved preferences
	}
}


function loadPreferences() {
	let preferences = null;

	try {
		preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY));
	} catch {
		// Use defaults
	}

	if (preferences)
		applyPreferences(preferences);

	isLoadingPreferences = false;
}


function applyPreferences(preferences) {
	PREFERENCE_CHECKBOXES.forEach(id => {
		let checkbox = document.getElementById(id);
		if (preferences.checkboxes && id in preferences.checkboxes && checkbox.checked != preferences.checkboxes[id]) {
			checkbox.checked = preferences.checkboxes[id];
			checkbox.dispatchEvent(new Event('change'));
		}
	});

	if (preferences.appTheme)
		setAppTheme(preferences.appTheme);

	if (preferences.colorScheme) {
		document.getElementById('color-scheme-' + preferences.colorScheme).checked = true;
		setColorScheme(preferences.colorScheme);
	}

	if (preferences.screen) {
		Object.assign(screen, preferences.screen);
		setScreenDimensions();
		redrawPad();
	}

	// Zoom of exactly 100% is the default of older versions, not a choice
	if (preferences.zoom && preferences.zoom != 'fit' && preferences.zoom != 1)
		setZoom(preferences.zoom);
}


function setColorScheme(index) {
	colorSchemeIndex = index;
	savePreferences();

	let screenpad = document.getElementById('screenpad');
	screenpad.classList.remove('scheme-1');
	screenpad.classList.remove('scheme-2');

	if (index > 0)
		screenpad.classList.add('scheme-' + index);
}