// Short messages that do not interrupt work
function showToast(message) {
	const SHORT_DELAY_MS = 5000;
	const LONG_DELAY_MS = 10000;

	let container = document.getElementById('toast-container');

	if (!container) {
		container = document.createElement('DIV');
		container.id = 'toast-container';
		container.setAttribute('role', 'status');
		container.setAttribute('aria-live', 'polite');
		document.body.appendChild(container);
	}

	let toast = document.createElement('DIV');
	toast.classList.add('toast');
	toast.textContent = message;
	toast.title = 'Click to dismiss';
	toast.addEventListener('click', () => toast.remove());
	container.appendChild(toast);

	setTimeout(() => toast.remove(), message.length > 60 ? LONG_DELAY_MS : SHORT_DELAY_MS);
}
