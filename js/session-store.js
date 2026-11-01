// Keeps unsaved work in IndexedDB (imported images can exceed localStorage limits)
const sessionStore = {
	_key: 'current',
	_store: 'session',
	_db: null,

	// Connection is shared between saves
	_open() {
		if (this._db)
			return this._db;

		this._db = new Promise((resolve, reject) => {
			let request = indexedDB.open('retropad-editor', 1);
			request.onupgradeneeded = () => request.result.createObjectStore(this._store);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		return this._db;
	},

	_run(mode, action) {
		return this._open().then(db => new Promise((resolve, reject) => {
			let transaction = db.transaction(this._store, mode);
			let request = action(transaction.objectStore(this._store));
			transaction.oncomplete = () => resolve(request.result);
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		}));
	},

	load() {
		return this._run('readonly', store => store.get(this._key));
	},

	save(session) {
		return this._run('readwrite', store => store.put(session, this._key));
	},

	clear() {
		return this._run('readwrite', store => store.delete(this._key));
	},
};
