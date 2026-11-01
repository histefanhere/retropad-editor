// Creates ZIP archive without compression (images are compressed already)
// files: array of { name: string, bytes: Uint8Array }
function createZipBlob(files) {
	const crcTable = new Uint32Array(256).map((_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++)
			c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
		return c;
	});

	let crc32 = (bytes) => {
		let crc = 0xFFFFFFFF;
		for (let i = 0; i < bytes.length; i++)
			crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
		return (crc ^ 0xFFFFFFFF) >>> 0;
	};

	const UTF8_FLAG = 0x0800;
	const VERSION = 20;

	let date = new Date();
	let dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
	let dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

	let encoder = new TextEncoder();
	let parts = [];
	let centralParts = [];
	let offset = 0;

	files.forEach(file => {
		let name = encoder.encode(file.name);
		let crc = crc32(file.bytes);
		let size = file.bytes.length;

		// Fields shared by local header (from offset 4) and central directory (from offset 6)
		let writeCommon = (view, pos) => {
			view.setUint16(pos, VERSION, true);
			view.setUint16(pos + 2, UTF8_FLAG, true);
			view.setUint16(pos + 4, 0, true);
			view.setUint16(pos + 6, dosTime, true);
			view.setUint16(pos + 8, dosDate, true);
			view.setUint32(pos + 10, crc, true);
			view.setUint32(pos + 14, size, true);
			view.setUint32(pos + 18, size, true);
			view.setUint16(pos + 22, name.length, true);
		};

		let local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034B50, true);
		writeCommon(local, 4);
		parts.push(local.buffer, name, file.bytes);

		let central = new DataView(new ArrayBuffer(46));
		central.setUint32(0, 0x02014B50, true);
		central.setUint16(4, VERSION, true);
		writeCommon(central, 6);
		central.setUint32(42, offset, true);
		centralParts.push(central.buffer, name);

		offset += 30 + name.length + size;
	});

	let centralSize = centralParts.reduce((sum, part) => sum + part.byteLength, 0);

	let end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054B50, true);
	end.setUint16(8, files.length, true);
	end.setUint16(10, files.length, true);
	end.setUint32(12, centralSize, true);
	end.setUint32(16, offset, true);

	return new Blob([...parts, ...centralParts, end.buffer], { type: 'application/zip' });
}
