// Browser checks of main features. Run with: npm run test:browser
// Uses installed Microsoft Edge; set BROWSER_CHANNEL=chrome to use Google Chrome.
const { chromium } = require('playwright-core');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const channel = process.env.BROWSER_CHANNEL || 'msedge';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const CONFIG = 'overlays = 2\noverlay0_name = "one"\noverlay0_descs = 3\noverlay0_full_screen = true\noverlay0_normalized = true\noverlay0_desc0 = "a,0.2,0.3,radial,0.1,0.1"\noverlay0_desc0_overlay = A.png\noverlay0_desc1 = "b,0.5,0.5,rect,0.05,0.08"\noverlay0_desc2 = "c,0.8,0.7,radial,0.04,0.04"\noverlay1_name = "two"\noverlay1_descs = 1\noverlay1_full_screen = true\noverlay1_normalized = true\noverlay1_desc0 = "z,0.5,0.5,radial,0.1,0.1"\n';

let failures = 0;
let finished = false;

// Playwright can report a closed target after a page is reloaded and closed
process.on('uncaughtException', error => {
	if (error.name != 'TargetClosedError' && !finished) {
		console.error(error);
		process.exit(2);
	}
});

function check(name, isOk, details) {
	console.log((isOk ? 'ok   ' : 'FAIL ') + name + (isOk || details === undefined ? '' : ' -> ' + details));
	if (!isOk)
		failures++;
}

function startServer() {
	const server = http.createServer((request, response) => {
		let file = decodeURIComponent(request.url.split('?')[0]);
		if (file == '/')
			file = '/index.html';

		fs.readFile(path.join(root, file), (error, data) => {
			if (error) {
				response.writeHead(404);
				response.end();
				return;
			}
			response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
			response.end(data);
		});
	});

	return new Promise(resolve => server.listen(0, () => resolve(server)));
}

async function main() {
	const server = await startServer();
	const url = 'http://localhost:' + server.address().port + '/';
	const browser = await chromium.launch({ channel, headless: true });
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'retropad-'));
	const configFile = path.join(temp, 'pad.cfg');
	fs.writeFileSync(configFile, CONFIG);

	const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
	const errors = [];
	const page = await context.newPage();
	page.on('pageerror', error => errors.push(error.message));
	page.on('dialog', dialog => dialog.accept());
	await page.goto(url);

	const config = () => page.evaluate(() => conf.getConfigString());
	const button = text => page.locator('.rect:has-text("' + text + '")').first();
	const desc = number => config().then(text => {
		const line = text.split('\n').find(l => l.startsWith('overlay0_desc' + number + ' ='));
		const parts = line.split('"')[1].split(',');
		return { x: Number(parts[1]), y: Number(parts[2]), w: Number(parts[4]), h: Number(parts[5]) };
	});
	const near = (a, b) => Math.abs(a - b) < 0.01;

	check('default pad renders', await page.locator('.rect').count() == 21);

	await page.setInputFiles('#load-config', configFile);
	await page.waitForTimeout(150);
	check('config imports', await page.locator('.rect').count() == 3);
	const imported = await config();
	const box = await page.locator('#screenpad').boundingBox();

	// Mouse drag, resize, undo
	const start = await button('b').boundingBox();
	const startX = start.x + start.width / 2;
	const startY = start.y + start.height / 2;
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + box.width * 0.1, startY, { steps: 3 });
	await page.mouse.up();
	check('drag moves button', near((await desc(1)).x, 0.6), (await desc(1)).x);

	const handle = await page.locator('.resize-handle').nth(3).boundingBox();
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2 + box.width * 0.05, handle.y + handle.height / 2, { steps: 3 });
	await page.mouse.up();
	check('handle resizes button', near((await desc(1)).w, 0.075), (await desc(1)).w);

	await page.keyboard.press('Control+z');
	await page.keyboard.press('Control+z');
	check('undo restores config', await config() == imported);

	// Keyboard
	await button('b').click();
	await page.keyboard.press('Shift+ArrowRight');
	check('arrow key nudges', near((await desc(1)).x, 0.51));
	await page.keyboard.press('Control+d');
	await page.waitForTimeout(30);
	check('duplicate adds button', await page.locator('.rect').count() == 4);
	await page.keyboard.press('Control+z');
	await page.keyboard.press('Control+z');

	// Touch: first tap selects, then the selected button drags
	const cdp = await context.newCDPSession(page);
	await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
	const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type == 'touchEnd' ? [] : [{ x, y, id: 1 }] });
	const center = async text => { const b = await button(text).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

	await page.keyboard.press('Escape');
	let [cx, cy] = await center('c');
	await touch('touchStart', cx, cy);
	await touch('touchEnd');
	await page.waitForTimeout(350);
	check('tap selects button', await button('c').evaluate(e => e.classList.contains('selected')));

	const before = await desc(2);
	await touch('touchStart', cx, cy);
	await touch('touchMove', cx - box.width * 0.05, cy);
	await touch('touchMove', cx - box.width * 0.1, cy);
	await touch('touchEnd');
	await page.waitForTimeout(100);
	check('touch drag moves selected button', near((await desc(2)).x, before.x - 0.1), (await desc(2)).x);

	await page.keyboard.press('Control+z');
	await page.keyboard.press('Escape');
	[cx, cy] = await center('c');
	await touch('touchStart', cx, cy);
	await touch('touchMove', cx - 40, cy);
	await touch('touchEnd');
	await page.waitForTimeout(100);
	check('touch on unselected button does not move it', near((await desc(2)).x, before.x), (await desc(2)).x);
	await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });

	// Inspector edits apply at once and can be undone
	await button('b').click();
	await page.selectOption('#command-select', 'start');
	check('input change applies', (await config()).includes('overlay0_desc1 = "start,'));
	check('selection survives edit', await page.locator('.rect.selected').count() == 1);
	await page.click('label:has(#shape-radial)');
	check('shape change applies', /overlay0_desc1 = "start,[^,]+,[^,]+,radial/.test(await config()));
	await page.click('#image-picker-button');
	await page.fill('#image-picker-filter', 'rgui');
	await page.click('#image-picker-grid .tile');
	check('image change applies', (await config()).includes('overlay0_desc1_overlay = rgui.png'));
	await page.click('#undo-button');
	await page.click('#undo-button');
	await page.click('#undo-button');
	check('edits can be undone', await config() == imported, await config());

	// Adding and deleting
	await page.click('#button-add-button');
	await page.click('#add-button-groups .tile:has-text("Open menu")');
	check('button is added and selected', await page.locator('.rect.selected:has-text("menu_toggle")').count() == 1);
	check('inspector shows new button', await page.inputValue('#command-select') == 'menu_toggle');
	await page.keyboard.press('Delete');
	check('delete needs no confirmation', await page.locator('.rect').count() == 3);
	await page.click('.toast button:has-text("Undo")');
	check('toast undoes delete', await page.locator('.rect').count() == 4);
	await page.click('#undo-button');
	check('add can be undone', await config() == imported);

	// Group selection: dragging over a single button selects it
	await page.keyboard.press('Escape');
	check('inspector shows overlay without selection', await page.locator('#inspector').getAttribute('data-mode') == 'overlay');
	const area = await button('c').boundingBox();
	await page.mouse.move(area.x - 12, area.y - 12);
	await page.mouse.down();
	await page.mouse.move(area.x + area.width + 8, area.y + area.height + 8, { steps: 3 });
	await page.mouse.up();
	check('area selection of one button edits it', await page.locator('#inspector').getAttribute('data-mode') == 'single');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Control+a');
	check('select all shows group tools', await page.locator('#inspector').getAttribute('data-mode') == 'multi');
	await page.keyboard.press('Escape');

	// Overlays
	await page.click('#overlay-list li:nth-child(2) button');
	check('overlay switches from list', await page.locator('.rect').count() == 1);
	await page.fill('#overlay-current-name', 'renamed');
	await page.locator('#overlay-current-name').blur();
	check('overlay renames in place', (await config()).includes('overlay1_name = "renamed"'));
	await page.click('#overlay-add-button');
	await page.fill('#overlay-name', 'renamed');
	await page.click('#overlay-create-button');
	check('duplicate name shows error', await page.locator('#overlay-name-error').isVisible());
	await page.fill('#overlay-name', 'third');
	await page.click('#overlay-create-button');
	check('overlay is added', await page.locator('#overlay-list li').count() == 3);
	check('new overlay is current', await page.locator('.row-empty').isVisible());
	await page.click('#undo-button');
	await page.click('#undo-button');
	await page.click('#overlay-list li:nth-child(1) button');
	check('overlay edits can be undone', await config() == imported);

	// Zoom and test mode
	await page.click('#zoom-in');
	const zoomed = await page.locator('#screenpad').boundingBox();
	check('zoom enlarges screen', zoomed.width > box.width);
	await page.click('#zoom-fit');
	const stage = await page.locator('#gamepad-container').boundingBox();
	const fitted = await page.locator('#screenpad').boundingBox();
	check('fit stays inside stage', fitted.width <= stage.width && fitted.height <= stage.height);
	check('fit has no scrolling', await page.evaluate(() => { let c = document.getElementById('gamepad-container'); return c.scrollWidth <= c.clientWidth && c.scrollHeight <= c.clientHeight; }));

	await page.click('#test-toggle');
	check('test mode shows banner', await page.locator('#test-banner').isVisible());
	await page.mouse.move(fitted.x + fitted.width * 0.2, fitted.y + fitted.height * 0.3);
	await page.mouse.down();
	check('test mode reports input', await page.locator('#test-readout').textContent() == 'a');
	await page.mouse.up();
	await page.keyboard.press('Escape');
	check('Esc leaves test mode', await page.locator('#test-banner').isHidden());

	// Export
	await page.click('#export-open-button');
	check('export shows check result', await page.locator('#check-summary').textContent() == 'Ready for RetroArch');
	const [cfg] = await Promise.all([page.waitForEvent('download'), page.click('#export-button')]);
	check('config downloads', cfg.suggestedFilename() == 'new-pad.cfg', cfg.suggestedFilename());
	check('download matches config', fs.readFileSync(await cfg.path(), 'utf8') == await config());
	const [zip] = await Promise.all([page.waitForEvent('download'), page.click('#export-zip-button')]);
	check('ZIP downloads', zip.suggestedFilename() == 'new-pad.zip', zip.suggestedFilename());
	await page.keyboard.press('Escape');

	// Autosave
	await button('a').click();
	await page.fill('#x-number', '0.25');
	await page.locator('#x-number').blur();
	const edited = await config();
	await page.waitForTimeout(800);
	const second = await context.newPage();
	second.on('dialog', dialog => dialog.accept());
	await second.goto(url);
	await second.waitForSelector('#session-restore-dialog:not(.hidden)');
	await second.click('#session-restore-button');
	check('autosave restores work', await second.evaluate(() => conf.getConfigString()) == edited);
	await second.close();

	// Phone layout
	await page.setViewportSize({ width: 390, height: 780 });
	await page.waitForTimeout(100);
	check('phone: panels start closed', await page.locator('#panel-outline').isHidden() && await page.locator('#inspector').isHidden());
	await page.click('#tab-inspector');
	check('phone: properties open', await page.locator('#inspector').isVisible());
	const phoneScreen = await page.locator('#screenpad').boundingBox();
	check('phone: screen fits width', phoneScreen.x >= 0 && phoneScreen.x + phoneScreen.width <= 390, phoneScreen.width);
	check('phone: screen is usable size', phoneScreen.width > 300, phoneScreen.width);
	await page.click('#tab-outline');
	check('phone: one panel at a time', await page.locator('#panel-outline').isVisible() && await page.locator('#inspector').isHidden());
	await page.setViewportSize({ width: 780, height: 380 });
	await page.waitForTimeout(100);
	const sideScreen = await page.locator('#screenpad').boundingBox();
	check('phone landscape: screen beside panel', sideScreen.x + sideScreen.width <= 480 && sideScreen.width > 200, sideScreen.width);
	check('phone: no sideways overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

	check('no page errors', errors.length == 0, errors.join(' | '));

	finished = true;
	await browser.close().catch(() => { });
	server.close();

	console.log(failures ? failures + ' failed' : 'All checks passed');
	process.exit(failures ? 1 : 0);
}

main().catch(error => {
	console.error(error);
	process.exit(2);
});
