// Dropdown menus and the panel tabs of narrow layouts
function closeMenus() {
	document.querySelectorAll('.menu:not(.hidden)').forEach(menu => {
		menu.classList.add('hidden');
		document.querySelector('[data-menu="' + menu.id + '"]').setAttribute('aria-expanded', 'false');
	});
}


function toggleMenu(button) {
	let menu = document.getElementById(button.dataset.menu);
	let isOpening = menu.classList.contains('hidden');

	closeMenus();

	if (isOpening) {
		menu.classList.remove('hidden');
		button.setAttribute('aria-expanded', 'true');

		let first = menu.querySelector('button, input, select');
		if (first)
			first.focus();
	}
}


function onMenuKeydown(event) {
	let menu = event.target.closest('.menu');
	if (!menu)
		return;

	if (event.key == 'Escape') {
		let button = document.querySelector('[data-menu="' + menu.id + '"]');
		closeMenus();
		button.focus();
		event.stopImmediatePropagation();
		return;
	}

	if (event.key != 'ArrowDown' && event.key != 'ArrowUp')
		return;

	if (event.target.matches('select'))
		return;

	let items = Array.from(menu.querySelectorAll('button:not(:disabled), input:not(.visually-hidden), select'));
	let step = event.key == 'ArrowDown' ? 1 : -1;
	items[(items.indexOf(event.target) + step + items.length) % items.length].focus();
	event.preventDefault();
	event.stopImmediatePropagation();
}


document.querySelectorAll('[data-menu]').forEach(button => {
	button.addEventListener('click', () => toggleMenu(button));
});

document.addEventListener('pointerdown', event => {
	if (!event.target.closest('.menu, [data-menu]'))
		closeMenus();
});

// Commands close the menu, while view options stay open to compare the results
document.getElementById('file-menu').addEventListener('click', closeMenus);
document.addEventListener('keydown', onMenuKeydown);


function togglePanelTab(name) {
	setPanelTab(document.body.dataset.panel == name ? '' : name);
}


function setPanelTab(name) {
	document.body.dataset.panel = name;
	document.getElementById('tab-outline').setAttribute('aria-pressed', name == 'outline');
	document.getElementById('tab-inspector').setAttribute('aria-pressed', name == 'inspector');
}
