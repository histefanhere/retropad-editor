// Starter gamepads. Button: [command, x, y, shape, w, h, image]; coordinates are for landscape overlay
{
	let dpad = (suffix) => [
		['left', 0.07188, 0.77778, 'radial', 0.04479, 0.06852, 'dpad-left' + suffix + '.png'],
		['right', 0.17813, 0.77778, 'radial', 0.04479, 0.06852, 'dpad-right' + suffix + '.png'],
		['up', 0.125, 0.68333, 'radial', 0.03854, 0.07963, 'dpad-up' + suffix + '.png'],
		['down', 0.125, 0.87222, 'radial', 0.03854, 0.07963, 'dpad-down' + suffix + '.png'],
		['left|up', 0.05625, 0.65556, 'rect', 0.03021, 0.0537],
		['right|up', 0.19375, 0.65556, 'rect', 0.03021, 0.0537],
		['left|down', 0.05625, 0.9, 'rect', 0.03021, 0.0537],
		['right|down', 0.19375, 0.9, 'rect', 0.03021, 0.0537],
	];

	let face = (command, x, y, image) => [command, x, y, 'radial', 0.04167, 0.07407, image];
	let shoulder = (command, x, y, image) => [command, x, y, 'rect', 0.05208, 0.09259, image];
	let center = (start, select) => [
		['start', 0.6, 0.91852, 'rect', 0.03958, 0.04444, start],
		['select', 0.4, 0.91852, 'rect', 0.04063, 0.04259, select],
	];

	let templates = [
		{
			id: 'nes',
			name: 'NES',
			buttons: [
				...dpad(''),
				face('b', 0.82, 0.82, 'B.png'),
				face('a', 0.92, 0.74, 'A.png'),
				...center('start_rounded.png', 'select_square_text.png'),
			],
		},
		{
			id: 'snes',
			name: 'SNES',
			buttons: [
				...dpad(''),
				face('a', 0.9375, 0.77778, 'A.png'),
				face('b', 0.875, 0.88889, 'B.png'),
				face('x', 0.875, 0.66667, 'X.png'),
				face('y', 0.8125, 0.77778, 'Y.png'),
				shoulder('l', 0.02917, 0.5, 'L.png'),
				shoulder('r', 0.97083, 0.5, 'R.png'),
				...center('start_psx.png', 'select_psx.png'),
			],
		},
		{
			id: 'genesis',
			name: 'Genesis (6 buttons)',
			buttons: [
				...dpad(''),
				face('y', 0.75, 0.86, 'A.png'),
				face('b', 0.84, 0.86, 'B.png'),
				face('a', 0.93, 0.86, 'C.png'),
				face('l', 0.75, 0.68, 'X.png'),
				face('x', 0.84, 0.68, 'Y.png'),
				face('r', 0.93, 0.68, 'Z.png'),
				['start', 0.5, 0.91852, 'rect', 0.03958, 0.04444, 'start_genesis.png'],
				['select', 0.5, 0.78, 'rect', 0.03958, 0.04444, 'genesis_mode.png'],
			],
		},
		{
			id: 'gba',
			name: 'Game Boy Advance',
			buttons: [
				...dpad(''),
				face('b', 0.82, 0.82, 'B.png'),
				face('a', 0.92, 0.74, 'A.png'),
				shoulder('l', 0.02917, 0.5, 'L.png'),
				shoulder('r', 0.97083, 0.5, 'R.png'),
				...center('start_rounded_big.png', 'select_rounded_big.png'),
			],
		},
		{
			id: 'psx',
			name: 'PlayStation',
			buttons: [
				...dpad('_psx'),
				face('a', 0.9375, 0.77778, 'circle.png'),
				face('b', 0.875, 0.88889, 'cross.png'),
				face('x', 0.875, 0.66667, 'triangle.png'),
				face('y', 0.8125, 0.77778, 'square.png'),
				shoulder('l', 0.02917, 0.5, 'L1.png'),
				shoulder('l2', 0.02917, 0.3, 'L2.png'),
				shoulder('r', 0.97083, 0.5, 'R1.png'),
				shoulder('r2', 0.97083, 0.3, 'R2.png'),
				...center('start_psx.png', 'select_psx.png'),
			],
		},
	];

	let number = (value) => +value.toFixed(5);

	let buildOverlay = (index, name, otherName, isPortrait, buttons) => {
		let all = buttons.concat([
			['menu_toggle', 0.078, 0.08889, 'radial', 0.02604, 0.04629, 'rgui.png'],
			['overlay_next', 0.922, 0.08889, 'radial', 0.02604, 0.04629, 'rotate.png'],
		]);

		let prefix = 'overlay' + index;
		let lines = [
			prefix + '_name = "' + name + '"',
			prefix + '_full_screen = true',
			prefix + '_normalized = true',
			prefix + '_range_mod = 1.5',
			prefix + '_alpha_mod = 2.0',
			prefix + '_aspect_ratio = ' + (isPortrait ? 0.5625 : 1.7777778),
			prefix + '_auto_x_separation = true',
			prefix + '_auto_y_separation = ' + !isPortrait,
			prefix + '_block_x_separation = false',
			prefix + '_block_y_separation = false',
			prefix + '_descs = ' + all.length,
		];

		all.forEach((b, i) => {
			let [command, x, y, shape, w, h, image] = b;

			// Portrait: keep button proportions on narrow screen and use lower part of it
			if (isPortrait) {
				y = 0.45 + y * 0.5;
				w = w * 16 / 9;
				h = h * 9 / 16;
			}

			let desc = prefix + '_desc' + i;
			lines.push(desc + ' = "' + [command, number(x), number(y), shape, number(w), number(h)].join(',') + '"');

			if (image)
				lines.push(desc + '_overlay = ' + image);

			if (command == 'overlay_next')
				lines.push(desc + '_next_target = "' + otherName + '"');
		});

		return lines;
	};

	window.padTemplates = templates.map(t => ({
		id: t.id,
		name: t.name,
		config: ['overlays = 2']
			.concat(buildOverlay(0, 'landscape', 'portrait', false, t.buttons))
			.concat(buildOverlay(1, 'portrait', 'landscape', true, t.buttons))
			.join('\n'),
	}));
}
