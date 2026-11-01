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
const HISTORY_LIMIT = 100;

let importedFilename = 'retropad.cfg';
let savedConfigStr;
let currentRect;
let suppressRectClick = false;
let cancelActiveDrag = null;

let undoStack = [];
let redoStack = [];
let historyCurrentStr;

let screen = {
	_width: DEF_WIDTH,
	_height: DEF_HEIGHT,

	isSetByUser: false,
	isPortrait: false,

	scale: 1,

	get longSide() { return Math.max(this._height, this._width) },
	get shortSide() { return Math.min(this._height, this._width) },

	set width(value) { this._width = Number(value || screen._width || DEF_WIDTH) },
	get enteredWidth() { return this.isPortrait ? this.shortSide : this.longSide },
	get width() { return this.enteredWidth * this.scale },

	set height(value) { this._height = Number(value || screen._height || DEF_HEIGHT) },
	get enteredHeight() { return this.isPortrait ? this.longSide : this.shortSide },
	get height() { return this.enteredHeight * this.scale },

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

fillCommandSelector(buttonCommandList);
fillImageSelector();

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
document.getElementById('overlay-selector').addEventListener('change', selectOverlay);

document.getElementById('command-select').addEventListener('change', fillCommandField);
document.getElementById('image-select').addEventListener('change', fillImageNameField);
document.getElementById('image-name').addEventListener('input', e => showImagePreview(e.target.value));

document.getElementById('load-config').addEventListener('change', loadConfigFromFile);
document.getElementById('load-button-images').addEventListener('change', loadImageFiles);
document.getElementById('load-screenshot').addEventListener('change', loadScreenshotFile);
document.getElementById('chk-show-screenshot').addEventListener('change', toggleScreenshot);

window.addEventListener('pointerdown', () => { suppressRectClick = false }, true);

document.addEventListener('keydown', closeTopDialogOnEscape);
window.addEventListener('beforeunload', warnAboutUnsavedChanges);


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

	for (let i = 0; i < rects.length; i++) {
		let r = rects[i];
		let b = createRect(background, r.command, r.x, r.y, r.w, r.h, r.pct);

		if (images[r.img])
			b.style['background-image'] = 'url(' + images[r.img] + ')';

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

		b.addEventListener('click', () => {
			if (suppressRectClick) {
				suppressRectClick = false;
				return;
			}

			selectRect(b, r.i);
			document.activeElement.blur();
		});
	}
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


function onRectPointerDown(event, rect, lineIndex) {
	if (event.button != 0 || event.shiftKey)
		return;

	// Touch: first tap selects, so pad area can still be scrolled
	if (event.pointerType != 'mouse' && !rect.classList.contains('selected'))
		return;

	document.activeElement.blur();

	if (!rect.classList.contains('selected'))
		selectRect(rect, lineIndex);

	let start = conf.getSelectionDimensions() || {
		x: Number(conf.getCurrentLineSectionValue('x')),
		y: Number(conf.getCurrentLineSectionValue('y')),
	};
	let frame = rect.parentElement.getBoundingClientRect();

	trackPointerDrag(rect, event, (dx, dy) => {
		setButtonParam('x', start.x + dx / frame.width);
		setButtonParam('y', start.y + dy / frame.height);
	});
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

	// x, y are center coordinates and w, h are half sizes; opposite corner stays in place
	trackPointerDrag(event.target, event, (dx, dy, moveEvent) => {
		let w = Math.max(MIN_BUTTON_SIZE, start.w + signX * dx / frame.width / 2);
		let h = Math.max(MIN_BUTTON_SIZE, start.h + signY * dy / frame.height / 2);

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
			let elem = document.querySelectorAll('.rect[data-line-index="' + index + '"]')[0];

			setTimeout(() => {
				elem.dispatchEvent(new Event('click'));
			}, 0);
		}
	}

	backgroundDiv.onmousedown = (event) => {
		if (event.button != 0)
			return;

		let bgRect = backgroundDiv.getBoundingClientRect();
		let tx = bgRect.left;
		let ty = bgRect.top;
		startX = event.clientX - tx;
		startY = event.clientY - ty;

		isMouseDown = true;
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
		} else {
			console.log('wrong selection index', e)
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

	let reader = new FileReader();
	reader.onload = function (ev) {
		let previousConfig = conf.getConfigString();
		let previousSaved = savedConfigStr;

		try {
			renderConfig(ev.target.result);
			configStr = ev.target.result;
			importedFilename = file.name;
		} catch {
			let errMsg = 'FILE PARSING ERROR!';
			console.log(errMsg);
			alert(errMsg + '\nPrevious config is restored.');
			renderConfig(previousConfig, true);
			savedConfigStr = previousSaved;
			e.target.value = '';
			document.getElementById('load-config-filename').textContent = '';
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
	},
		images);
}


function loadImageFiles(e) {
	let imgCounter = 0;
	let loadCounter = 0;

	for (let i = 0; i < e.target.files.length; i++) {
		let file = e.target.files[i];

		if (!file || !/\.(png|jpe?g)$/i.test(file.name))
			continue;

		imgCounter++;
		let name = e.target.files[i].name;
		console.log(name);

		let reader = new FileReader();

		reader.onload = function (ev) {
			images[name] = ev.target.result;

			if (!userImages.includes(name)) {
				userImages.push(name);
				console.log(name);
			}

			// onload is async function so loop ends BEFORE it's first launch
			if (++loadCounter == imgCounter) {
				redrawPad();
				fillImageSelector();
			}
		};

		reader.readAsDataURL(file);
	}
}


function loadScreenshotFile(e) {
	let file = e.target.files[0];
	if (!file)
		return;

	let name = file.name;
	console.log(name);

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
				console.log('Size', im.naturalWidth, im.naturalHeight);

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
	let text = document.createTextNode(name);
	rect.appendChild(text);
	rect.classList.add('rect');

	if (pct) {
		// visualize thumbstick saturate_pct property
		let inner = document.createElement('DIV');
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
}


function resetHistory() {
	undoStack.length = 0;
	redoStack.length = 0;
	historyCurrentStr = conf.getConfigString();
	updateHistoryButtons();
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
}


function updateHistoryButtons() {
	document.getElementById('undo-button').disabled = undoStack.length == 0;
	document.getElementById('redo-button').disabled = redoStack.length == 0;
}


function resetScreen() {
	let s = document.getElementById('screenpad');

	s.style.width = screen.width + 'px';
	s.style.height = screen.height + 'px';

	s.innerHTML = '';

	let d = document.createElement('DIV');
	d.classList.add('inner');
	d.id = 'game-screenshot'

	let shotWidth = screen.shotFrameWidth * screen.scale;
	let shotHeight = screen.shotFrameHeight * screen.scale;

	d.style.width = shotWidth + 'px';
	d.style.height = shotHeight + 'px';

	d.style.left = (screen.width - shotWidth) / 2 + 'px';

	if (screen.isPortrait)
		d.style.top = 0;
	else
		d.style.top = (screen.height - shotHeight) / 2 + 'px';

	s.appendChild(d);
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

	hideScreenSizeDialog();

	if (document.getElementById('chk-rescale-to-fit').checked)
		screen.scale = calculateScreenSizeToFit(w, h);
	else
		screen.scale = 1;

	setScreenDimensions(w, h, sw, sh);

	redrawPad();
}


function exportConfig() {
	let configText = conf.getConfigString();
	let file = new Blob([configText], { type: 'text/plain' });
	let a = document.createElement('A');
	a.href = URL.createObjectURL(file);
	a.download = 'new-' + importedFilename.replace(/^new-/, '');
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 0);

	savedConfigStr = configText;
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
	}
}


function buildAndSetOverlaySelectors(selectIndex) {
	let list = conf.getOverlayList();

	let select = document.getElementById('overlay-selector');
	select.innerHTML = '';

	for (let i = 0; i < list.length; i++) {
		let name = (i + 1) + ' - ' + (list[i] ? list[i] : '[unnamed]');
		let o = document.createElement('OPTION');
		o.appendChild(document.createTextNode(name));
		select.appendChild(o);
	}

	selectIndex = Math.min(selectIndex, list.length - 1);
	select.selectedIndex = selectIndex;
	conf.setCurrentOverlay(selectIndex);
	screen.isPortrait = list[selectIndex].search('portrait') != -1;

	document.getElementById('chk-show-portrait').checked = screen.isPortrait;

	let selectNext = document.getElementById('next_target_property');
	selectNext.innerHTML = '';

	selectNext.appendChild(document.createElement('OPTION'));

	for (let i = 0; i < list.length; i++) {
		if (list[i]) {
			let o = document.createElement('OPTION');
			o.appendChild(document.createTextNode(list[i]));
			selectNext.appendChild(o);
		}
	}
}


function fillButtonEditor(command, shape, image, addLines) {
	document.getElementById('command-name').value = command;
	document.getElementById('button-shape').selectedIndex = shape == 'rect' ? 0 : 1;

	if (image)
		document.getElementById('image-name').value = image;
	else
		document.getElementById('image-name').value = '';

	showImagePreview(image);

	setImageSelectorOption(image);
	setCommandSelectorOption(command);

	fillAdditionalPropsFields(addLines.split('\n'));
}


function fillImageSelector() {
	let selector = document.getElementById('image-select');
	selector.innerHTML = '';

	userImages.sort();

	let listAll = [];
	if (userImages.length > 0)
		listAll = listAll.concat(userImages);

	let defImages = [''];
	for (let f in images)
		if (!userImages.includes(f))
			defImages.push(f);

	listAll = listAll.concat(defImages);

	for (let name of listAll) {
		let o = document.createElement('OPTION');
		o.appendChild(document.createTextNode(name));
		selector.appendChild(o);
	}
}


function setImageSelectorOption(value) {
	let s = document.getElementById('image-select');
	s.value = '';

	for (let i = 0; i < s.options.length; i++) {
		if (s.options[i].text == value) {
			s.selectedIndex = i;
			break;
		}
	}
}


function fillCommandSelector(commands) {
	commands = commands.split('\n');
	let s = document.getElementById('command-select');

	commands.forEach((e) => {
		let o = document.createElement('OPTION');
		o.appendChild(document.createTextNode(e));
		s.appendChild(o);
	})
}


function setCommandSelectorOption(value) {
	let s = document.getElementById('command-select');
	s.selectedIndex = 0;

	for (let i = 0; i < s.options.length; i++) {
		if (s.options[i].text == value) {
			s.selectedIndex = i;
			break;
		}
	}
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
	document.getElementById('show-button-editor').disabled = !enable;
	document.getElementById('del-current-button').disabled = !enable;
}


function enableEditorSliders(enable) {
	let editor = document.getElementById('editor');
	let inputs = editor.querySelectorAll('input,button');
	inputs.forEach(e => { e.disabled = !enable })
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

		try {
			fields = document.querySelectorAll('.js-additional-button-property #' + prop + '_property');
		} catch {
			console.log('probably wrong property name', prop);
		}

		switch (fields.length) {
			case 1:
				fields[0].value = val;
				break;

			case 0:
				othData += e + '\n';
				break;

			default:
				console.log('More than one ui element found!');
		}

	});

	others.value = othData.trim();
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
			alert('Error in line "' + line + '"\nProperty removed');
			return;
		}

		let prop = line.substr(0, eqPos).trim();
		let value = line.substr(eqPos + 1).trim();

		ret.push(prop + ' = ' + value);
	});

	return ret;
}


function resetButtonDialog() {
	document.getElementById('command-select').value = 'a';
	document.getElementById('image-select').value = 'A.png';

	document.getElementById('command-name').value = 'a';
	document.getElementById('image-name').value = 'A.png';
	showImagePreview('A.png');

	document.getElementById('button-shape').value = 'radial';

	clearAdditionalPropsFields();
}


function showDialog(elementId, isShow) {
	let dialog = document.getElementById(elementId);

	if (!dialog)
		return;

	if (isShow) {
		dialog.classList.remove('hidden');
	} else {
		dialog.classList.add('hidden');
		return;
	}

	let focusCandidates = document.querySelectorAll('#' + elementId + ' .js-dialog__focus');
	if (focusCandidates.length > 0)
		focusCandidates[0].focus();
}


function showImagePreview(imgName) {
	let image = images[imgName];
	let gradient = 'linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 80%, #aac 90%)';
	let box = document.getElementById('image-name');

	if (image)
		box.style['background-image'] = 'url(' + image + '), ' + gradient;
	else
		box.style['background-image'] = 'none';
}


function generateOverlayName(isPortrait) {
	let prefix = isPortrait ? 'portrait' : 'landscape';
	let index = conf.getOverlayList().length + 1;

	while (conf.isOverlayNameExist(prefix + '-' + index)) {
		index++;
	}

	document.getElementById('overlay-name').value = prefix + '-' + index;
}


function calculateScreenSizeToFit(width, height) {
	let vw = window.innerWidth;
	let _width = Math.max(width, height);
	let _height = Math.min(width, height);
	let scale;

	if (vw < 600) {
		let coef = 0.85;
		let theight = vw * coef;
		scale = theight / _height;
		console.log('[RESCALE] viewport width ' + vw + 'px - screen height ' + theight + 'px (' + coef + ')');
	} else {
		let coef = vw <= 1280 ? 0.7 : 0.55;
		let twidth = vw * coef;
		scale = twidth / _width;
		console.log('[RESCALE] viewport width ' + vw + 'px - screen width ' + twidth + 'px (' + coef + ')');
	}

	let swidth = +(width * scale).toFixed(2);
	let sheight = +(height * scale).toFixed(2);
	console.log('scale factor ' + scale + ' (from ' + width + 'x' + height + ' to ' + swidth + 'x' + sheight + ')');

	return scale;
}


function closeTopDialogOnEscape(event) {
	if (event.key != 'Escape')
		return;

	// nested dialogs are placed after their parents in markup
	let dialogs = document.querySelectorAll('.dialog-container:not(.hidden)');
	if (dialogs.length > 0)
		showDialog(dialogs[dialogs.length - 1].id, false);
}


function warnAboutUnsavedChanges(event) {
	if (conf.getConfigString() == savedConfigStr)
		return;

	event.preventDefault();
	event.returnValue = '';
}


// Inline event listeners

function resetPad() {
	showDialog('reset-dialog', false);
	renderConfig(configStr);
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
}


function flipXcoord() {
	let x = conf.flipXcoord()
	document.getElementById('x-range').value = x;
	document.getElementById('x-number').value = x;
	updateCurrentLine();
	syncSelectedButtons();
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
		alert('Enter positive values for all dimensions');
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

	d.command = document.getElementById('command-name').value.trim() || 'null';
	if (d.command.search(/\s/) != -1) {
		d.warn = true;
		alert('Button command should not contain spaces');
	}

	d.shape = ['rect', 'radial'][document.getElementById('button-shape').selectedIndex];
	d.image = document.getElementById('image-name').value;

	d.lines = readAdditionalPropsFields();
	console.log(d.lines);

	return d;
}


function addButton() {
	let d = getButtonDataFromDialog();
	if (d.warn)
		return;

	hideButtonEditor();
	conf.createButton(d.command, d.shape, d.image, d.lines);
	redrawPad();
}


function editButton() {
	let d = getButtonDataFromDialog();
	if (d.warn)
		return;

	hideButtonEditor();
	conf.updateCurrentButton(d.command, d.shape, d.image, d.lines);
	conf.setCurrentLine(-1);
	redrawPad();
}


function addOverlay() {
	let name = document.getElementById('overlay-name').value.trim();
	let raw = document.getElementById('raw-overlay-properties').value;
	let props = processRawProperties(raw);

	if (conf.isOverlayNameExist(name)) {
		showDialog('name-exist-dialog', true);
		return;
	}

	if (name == '') {
		showDialog('name-empty-dialog', true);
		return;
	}

	if (document.getElementById('chk-duplicate-overlay').checked)
		conf.duplicateCurrentOverlay(name, props);
	else
		conf.createOverlay(name, props);

	hideOverlayEditor();
	buildAndSetOverlaySelectors(1000);
	setScreenDimensions();
	redrawPad();
}


function editOverlay() {
	let name = document.getElementById('overlay-name').value.trim();
	let raw = document.getElementById('raw-overlay-properties').value;

	if (conf.getCurrentOverlayName() != name && conf.isOverlayNameExist(name)) {
		showDialog('name-exist-dialog', true);
		return;
	}

	if (name == '') {
		showDialog('name-empty-dialog', true);
		return;
	}

	conf.editCurrentOverlay(name, processRawProperties(raw));

	hideOverlayEditor();
	buildAndSetOverlaySelectors(conf.getCurrentOverlay());
	setScreenDimensions();
	redrawPad();
}


function delCurrentButton() {
	showDialog('button-delete-dialog', false);

	if (!conf.deleteCurrentButton())
		alert('No selection!');
	redrawPad();
}


function delCurrentOverlay() {
	showDialog('overlay-delete-dialog', false);

	conf.deleteCurrentOverlay();
	buildAndSetOverlaySelectors(0);
	setScreenDimensions();
	redrawPad();
}


function showButtonEditor() {
	let values = conf.getCurrentButtonParams();

	fillButtonEditor(values.command, values.shape, values.image, values.addLines.join('\n'));

	document.getElementById('button-create-button').classList.add('hidden');
	document.getElementById('button-edit-button').classList.remove('hidden');
	showDialog('button-create-dialog', true);
}


function showButtonCreator() {
	resetButtonDialog();
	document.getElementById('button-create-button').classList.remove('hidden');
	document.getElementById('button-edit-button').classList.add('hidden');
	showDialog('button-create-dialog', true);
}


function hideButtonEditor() {
	showDialog('button-create-dialog', false);
}


function showOverlayEditor() {
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


function showScreenSizeDialog() {
	document.getElementById('display-width').value = screen.longSide;
	document.getElementById('display-height').value = screen.shortSide;

	document.getElementById('screenshot-width').value = screen.shotFrameWidth;
	document.getElementById('screenshot-height').value = screen.shotFrameHeight;

	document.getElementById('radio-screenshot-' + screen.shotMode).checked = true;

	document.getElementById('chk-rescale-to-fit').checked = screen.scale != 1;

	let screenshotMatch = document.getElementById('radio-screenshot-match');
	screenshotMatch.disabled = (!screen.shotImage || !screen.shotShow);

	onScreenshotModeChange();

	showDialog('screen-size-dialog', true);
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


function hideScreenSizeDialog() {
	showDialog('screen-size-dialog', false);
}


function showFileDialog() {
	document.getElementById('chk-show-screenshot').disabled = !screen.shotImage;
	showDialog('import-export-dialog', true);
}


function hideFileDialog() {
	showDialog('import-export-dialog', false);
}


function fillImageNameField(event) {
	document.getElementById('image-name').value = event.target.value;
	showImagePreview(event.target.value);
}


function fillCommandField(event) {
	let command = event.target.value;

	clearAdditionalPropsFields();

	document.getElementById('command-name').value = command;
	let lines = showAdditionalParametersForCommand(command);
	if (lines) {
		fillAdditionalPropsFields(lines.split('\n'));
		toggleAdditionalButtonProperties(true);
	}
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


function toggleOffscreen(event) {
	let screenDiv = document.getElementById('screenpad');

	if (event.target.checked) {
		screenDiv.classList.add('show-offscreen');
		screenDiv.classList.remove('hide-offscreen');
	} else {
		screenDiv.classList.remove('show-offscreen');
		screenDiv.classList.add('hide-offscreen');
	}
}


function toggleAdditionalButtonProperties(show) {
	let adds = document.getElementsByClassName('js-additional-button-property');
	let addBtn = document.getElementById('btn-additional-button');

	if (show || adds[0].classList.contains('hidden')) {
		addBtn.classList.add('expanded');
		for (let i = 0; i < adds.length; i++)
			adds[i].classList.remove('hidden');
	} else {
		addBtn.classList.remove('expanded');
		for (let i = 0; i < adds.length; i++)
			adds[i].classList.add('hidden');
	}
}


function toggleAdditionalOverlayProperties(show) {
	let add = document.getElementById('overlay-properties-container');
	let addBtn = document.getElementById('overlay-additional-button');

	if (show || add.classList.contains('hidden')) {
		add.classList.remove('hidden');
		addBtn.classList.add('expanded');
	} else {
		add.classList.add('hidden');
		addBtn.classList.remove('expanded');
	}
}


function toggleScreenshotSettings() {
	let settings = document.getElementById('screenshot-area-settings');
	let expander = document.getElementById('screenshot-settings-expander')

	if (settings.classList.contains('hidden')) {
		settings.classList.remove('hidden');
		expander.classList.add('expanded');
	} else {
		settings.classList.add('hidden');
		expander.classList.remove('expanded');
	}
}


function updateNewOverlayFields() {
	let box = document.getElementById('raw-overlay-properties');
	let duplicateChk = document.getElementById('chk-duplicate-overlay');
	let portraitChk = document.getElementById('chk-portrait-overlay');
	let editChk = document.getElementById('chk-edit-overlay');

	let isDuplicate = duplicateChk.checked;
	let isPortrait = portraitChk.checked;
	let isEdit = editChk.checked;

	if (isEdit)
		toggleAdditionalOverlayProperties(true);

	let aspect = screen.longSide / screen.shortSide;

	let createBtn = document.getElementById('overlay-create-button');
	let editBtn = document.getElementById('overlay-edit-button');
	if (isEdit) {
		editBtn.classList.remove('hidden')
		createBtn.classList.add('hidden');
		duplicateChk.disabled = true;
		duplicateChk.checked = false;
		document.getElementById('overlay-name').value = conf.getCurrentOverlayName();
		_fillCurrentOverlay();
		return;
	} else {
		editBtn.classList.add('hidden')
		createBtn.classList.remove('hidden');
		duplicateChk.disabled = false;
	}

	if (isDuplicate) {
		_fillCurrentOverlay();
	} else {
		portraitChk.disabled = false;
		let ratio = 'aspect_ratio = ' + +(isPortrait ? 1 / aspect : aspect).toFixed(7);
		box.value = defaultParamsForNewOverlay + '\n' + ratio;
		box.value += '\n' + autoScaleParams + 'auto_y_separation = ' + (isPortrait ? 'false' : 'true');
		box.value += '\n' + manualScaleParams;
	}

	generateOverlayName(isPortrait);


	function _fillCurrentOverlay() {
		box.value = conf.getCurrentOverlayParams().join('\n');
		isPortrait = document.getElementById('overlay-selector').value.search('portrait') != -1;
		portraitChk.checked = isPortrait;
		portraitChk.disabled = true;
	}
}


function selectOverlay(event) {
	conf.setCurrentOverlay(event.target.selectedIndex);
	conf.setCurrentLine(-1);

	if (event.target.value.search('portrait') != -1)
		screen.isPortrait = true;

	if (event.target.value.search('landscape') != -1)
		screen.isPortrait = false;

	document.getElementById('chk-show-portrait').checked = screen.isPortrait;

	setScreenDimensions();
	redrawPad();
}


function showColorsDialog() {
	showDialog('colors-dialog', true);
}


function setColorScheme(index) {
	let screenpad = document.getElementById('screenpad');
	screenpad.classList.remove('scheme-1');
	screenpad.classList.remove('scheme-2');

	if (index > 0)
		screenpad.classList.add('scheme-' + index);
}