// Short messages that do not interrupt work
function showToast(message, actionLabel, onAction) {
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

	let text = document.createElement('SPAN');
	text.textContent = message;
	toast.appendChild(text);

	if (actionLabel) {
		let action = document.createElement('BUTTON');
		action.textContent = actionLabel;
		action.addEventListener('click', () => {
			toast.remove();
			onAction();
		});
		toast.appendChild(action);
	}

	let dismiss = document.createElement('BUTTON');
	dismiss.classList.add('toast__dismiss');
	dismiss.textContent = '×';
	dismiss.setAttribute('aria-label', 'Dismiss');
	dismiss.addEventListener('click', () => toast.remove());
	toast.appendChild(dismiss);

	container.appendChild(toast);

	setTimeout(() => toast.remove(), message.length > 60 ? LONG_DELAY_MS : SHORT_DELAY_MS);
}
