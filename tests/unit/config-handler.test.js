// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const messages = [];

const context = vm.createContext({
	console,
	showToast: message => messages.push(message),
	window: {},
});
context.window = context;

for (const file of ['defaults.js', 'templates.js', 'config-handler.js'])
	vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);

const ConfigHandler = context.ConfigHandler;

const CONFIG = [
	'overlays = 2',
	'overlay0_name = "one"',
	'overlay0_normalized = true',
	'overlay0_range_mod = 1.5',
	'overlay0_descs = 3',
	'overlay0_desc0 = "a,0.2,0.3,radial,0.1,0.1"',
	'overlay0_desc0_overlay = A.png',
	'overlay0_desc0_alpha_mod = 1.5',
	'overlay0_desc1 = "b,0.5,0.5,rect,0.05,0.08"',
	'overlay0_desc2 = "overlay_next,0.8,0.7,radial,0.04,0.04"',
	'overlay0_desc2_next_target = "two"',
	'overlay1_name = "two"',
	'overlay1_normalized = true',
	'overlay1_descs = 1',
	'overlay1_desc0 = "z,0.5,0.5,radial,0.1,0.1"',
].join('\n');

function load(str = CONFIG, images = {}) {
	const conf = new ConfigHandler();
	conf.convertCfgToArray(str, () => { }, images);
	return conf;
}

function lineIndex(conf, name) {
	return conf.getConfigString().split('\n').findIndex(l => l.startsWith(name + ' ='));
}

test('config survives import and export unchanged', () => {
	assert.strictEqual(load().getConfigString(), CONFIG);
	assert.strictEqual(load(load().getConfigString()).getConfigString(), CONFIG);
});

test('export is stable when called repeatedly', () => {
	const conf = load();
	assert.strictEqual(conf.getConfigString(), conf.getConfigString());
});

test('comments, blank lines and image paths are removed', () => {
	const conf = load([
		'# comment',
		'',
		'overlays = 1 # inline',
		'overlay0_normalized = true',
		'overlay0_descs = 1',
		'overlay0_desc0 = "a,0.5,0.5,rect,0.1,0.1" # inline',
		'overlay0_desc0_overlay = img/dir/A.png',
	].join('\n'));

	assert.strictEqual(conf.getConfigString(), [
		'overlays = 1',
		'overlay0_normalized = true',
		'overlay0_descs = 1',
		'overlay0_desc0 = "a,0.5,0.5,rect,0.1,0.1"',
		'overlay0_desc0_overlay = A.png',
	].join('\n'));
});

test('integer overlays are normalized', () => {
	const conf = load('overlays = 1\noverlay0_overlay = bg.png\noverlay0_descs = 1\noverlay0_desc0 = "a,640,360,rect,64,36"');
	const button = conf.buildPadFromConfig()[0];
	assert.strictEqual(Number(button.x), 0.5);
	assert.strictEqual(Number(button.h), 0.05);
});

test('deleting a button renumbers the others', () => {
	const conf = load();
	conf.setCurrentLine(lineIndex(conf, 'overlay0_desc0'));
	assert.strictEqual(conf.deleteCurrentButton(), true);

	const text = conf.getConfigString();
	assert.ok(text.includes('overlay0_descs = 2'));
	assert.ok(text.includes('overlay0_desc0 = "b,'));
	assert.ok(text.includes('overlay0_desc1_next_target = "two"'));
	assert.ok(!text.includes('alpha_mod'));
});

test('group delete refuses to remove every button', () => {
	const conf = load();
	conf.selectButtonsInBounds(0, 0, 1, 1);
	conf.deleteSelectedButtons();
	assert.ok(conf.getConfigString().includes('overlay0_descs = 3'));
});

test('duplicate copies image and properties', () => {
	const conf = load();
	conf.setCurrentLine(lineIndex(conf, 'overlay0_desc0'));
	conf.duplicateSelectedButtons((x, y) => ({ x: x + 0.1, y: y }));

	const text = conf.getConfigString();
	assert.ok(text.includes('overlay0_descs = 4'));
	assert.ok(text.includes('overlay0_desc3 = "a,0.30000,0.30000,radial,0.1,0.1"'));
	assert.ok(text.includes('overlay0_desc3_overlay = A.png'));
	assert.ok(text.includes('overlay0_desc3_alpha_mod = 1.5'));
});

test('moving an overlay keeps its content and name links', () => {
	const conf = load();
	assert.strictEqual(conf.moveCurrentOverlay(-1), false);
	assert.strictEqual(conf.moveCurrentOverlay(1), true);
	assert.strictEqual(conf.getCurrentOverlay(), 1);

	const text = conf.getConfigString();
	assert.ok(text.includes('overlay0_name = "two"'));
	assert.ok(text.includes('overlay1_desc2_next_target = "two"'));
	assert.deepStrictEqual(Array.from(conf.getConfigProblems({ 'A.png': 'x' })), []);

	assert.strictEqual(conf.moveCurrentOverlay(-1), true);
	assert.strictEqual(conf.getConfigString().split('\n').sort().join(), CONFIG.split('\n').sort().join());
});

test('moving a button swaps it with its neighbour', () => {
	const conf = load();
	const line = conf.moveButton(lineIndex(conf, 'overlay0_desc0'), 1);
	const text = conf.getConfigString();

	assert.ok(text.split('\n')[line].startsWith('overlay0_desc1 = "a,'));
	assert.ok(text.includes('overlay0_desc0 = "b,'));
	assert.ok(text.includes('overlay0_desc1_overlay = A.png'));
	assert.strictEqual(conf.moveButton(lineIndex(conf, 'overlay0_desc2'), 1), null);
});

test('renaming an overlay with regex characters updates links', () => {
	const conf = load(CONFIG.replace(/"two"/g, '"t(w"'));
	conf.setCurrentOverlay(1);
	conf.editCurrentOverlay('new', []);
	assert.ok(conf.getConfigString().includes('overlay0_desc2_next_target = "new"'));
});

test('flip, align and distribute change positions', () => {
	const conf = load();
	conf.selectButtonsInBounds(0, 0, 1, 1);
	conf.flipSelection('x');
	let pad = conf.buildPadFromConfig();
	assert.strictEqual(Number(pad[0].x), 0.8);

	conf.alignSelection('top');
	pad = conf.buildPadFromConfig();
	assert.ok(Math.abs((Number(pad[0].y) - Number(pad[0].h)) - (Number(pad[1].y) - Number(pad[1].h))) < 1e-4);

	conf.distributeSelection('x');
	pad = conf.buildPadFromConfig().map(b => Number(b.x)).sort();
	assert.ok(Math.abs(pad[1] - pad[0] - (pad[2] - pad[1])) < 1e-4);
});

test('problems are reported', () => {
	const conf = load(CONFIG.replace('next_target = "two"', 'next_target = "gone"').replace('"z,0.5,', '"z,3,'));
	const problems = conf.getConfigProblems({}).join();

	assert.ok(problems.includes('A.png'));
	assert.ok(problems.includes('"gone"'));
	assert.ok(problems.includes('off screen'));
	assert.deepStrictEqual(Array.from(load().getConfigProblems({ 'A.png': 'x' })), []);
});

test('hit areas use range_mod and shape', () => {
	const conf = load();
	const [a, b] = conf.getHitAreas(0);

	assert.ok(Math.abs(a.w - 0.15) < 1e-9);
	assert.ok(conf.isPointInHitArea(a, 0.34, 0.3));
	assert.ok(!conf.isPointInHitArea(a, 0.33, 0.43));
	assert.ok(conf.isPointInHitArea(b, 0.57, 0.61));
});

test('overlaps ignore pairs sharing a command', () => {
	const conf = load('overlays = 1\noverlay0_normalized = true\noverlay0_descs = 3\noverlay0_desc0 = "up,0.5,0.5,rect,0.1,0.1"\noverlay0_desc1 = "left|up,0.55,0.5,rect,0.1,0.1"\noverlay0_desc2 = "b,0.6,0.5,rect,0.1,0.1"');
	const notes = conf.getHitAreaOverlaps();

	assert.strictEqual(notes.length, 2);
	assert.ok(notes.every(note => note.includes(' b ') || note.endsWith('b overlap')));
});

test('config text errors are found', () => {
	const conf = load();
	assert.strictEqual(conf.findConfigTextError(CONFIG), null);
	assert.strictEqual(conf.findConfigTextError('hello'), 'overlays = <count>');
	assert.strictEqual(conf.findConfigTextError('overlays = 1\noverlay0_desc0 = "a,1"'), 'overlay0_desc0 = "a,1"');
});

test('used images are listed once', () => {
	const conf = load(CONFIG + '\noverlay1_desc0_overlay = A.png\noverlay1_overlay = "bg file.png"');
	assert.deepStrictEqual(Array.from(conf.getUsedImages()).sort(), ['A.png', 'bg file.png']);
});

test('default config and templates are valid', () => {
	const images = context.defaultImagesObj;
	const configs = [context.defaultConfigString].concat(context.padTemplates.map(t => t.config));

	configs.forEach(config => {
		const conf = load(config, images);
		assert.deepStrictEqual(Array.from(conf.getConfigProblems(images)), []);
		assert.strictEqual(conf.findConfigTextError(config), null);
	});
});

test('every default image file exists', () => {
	Object.values(context.defaultImagesObj).forEach(file => {
		assert.ok(fs.existsSync(path.join(root, file)), file);
	});
});
