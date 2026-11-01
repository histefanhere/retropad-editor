const CACHE_NAME = 'retropad-editor-v2';

self.window = self;
importScripts('js/defaults.js');

const APP_FILES = [
	'./',
	'index.html',
	'manifest.webmanifest',
	'aspect-ratio-hint.svg',
	'css/style.css',
	'js/toast.js',
	'js/defaults.js',
	'js/templates.js',
	'js/config-handler.js',
	'js/session-store.js',
	'js/zip-writer.js',
	'js/menus.js',
	'js/editor.js',
	'img/retroarch-icon.svg',
];

self.addEventListener('install', event => {
	let files = APP_FILES.concat(Object.values(self.defaultImagesObj));

	event.waitUntil(
		caches.open(CACHE_NAME)
			.then(cache => Promise.all(files.map(file => cache.add(file).catch(() => { }))))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys()
			.then(keys => Promise.all(keys.filter(key => key != CACHE_NAME).map(key => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

// Network first, so updates show up at once; cache is used when offline
self.addEventListener('fetch', event => {
	let url = new URL(event.request.url);
	if (event.request.method != 'GET' || url.origin != location.origin)
		return;

	event.respondWith(
		fetch(event.request)
			.then(response => {
				if (response.ok) {
					let copy = response.clone();
					caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
				}
				return response;
			})
			.catch(() => caches.match(event.request).then(cached => cached || caches.match('index.html')))
	);
});
