{
	let fileInputs = document.querySelectorAll('input[type=file]');
	fileInputs.forEach(elem => {
		let fspan = document.getElementById(elem.id + '-filename');

		// allow importing same file again (change event is not fired otherwise)
		elem.addEventListener('click', () => { elem.value = '' });

		if (fspan)
			elem.addEventListener('change', event => {
				let name = '';
				switch (event.target.files.length) {
					case 0:
						name = "Browse";
						break;

					case 1:
						name = event.target.files[0].name;
						break;

					default:
						name = event.target.files.length + ' files';
				}
				fspan.textContent = name;

			});
	});
}
