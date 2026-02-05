This file is a merged representation of the entire codebase, combined into a single document by Repomix.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
css/styles.css
index.html
js/app.js
js/utils.js
js/webadb.js
README.md
Videos/1.mp4
Videos/2.mp4
```

# Files

## File: js/webadb.js
```javascript
// SPDX-License-Identifier: MIT

(function(root, factory) {
	if (typeof define === 'function' && define.amd) {
		define([], factory);
	} else if (typeof exports === 'object') {
		module.exports = factory();
	} else {
		root.Adb = factory();
	}
}(this, function() {
	'use strict';

	let Adb = {};

	Adb.Opt = {};
	Adb.Opt.debug = false;
	Adb.Opt.dump = false;

	Adb.Opt.key_size = 2048;
	Adb.Opt.reuse_key = -1;

	// Set this to false for new devices (post Dec 2017) if
	// autodetection doesn't handle it automatically.
	Adb.Opt.use_checksum = true;

	let db = init_db();
	let keys = db.then(load_keys);

	Adb.open = function(transport) {
		if (transport == "WebUSB")
			return Adb.WebUSB.Transport.open();

		throw new Error("Unsupported transport: " + transport);
	};

	Adb.WebUSB = {};

	Adb.WebUSB.Transport = function(device) {
		this.device = device;

		if (Adb.Opt.debug)
			console.log(this);
	};

	Adb.WebUSB.Transport.open = function() {
		let filters = [
			{ classCode: 255, subclassCode: 66, protocolCode: 1 },
			{ classCode: 255, subclassCode: 66, protocolCode: 3 }
		];

		return navigator.usb.requestDevice({ filters: filters })
			.then(device => device.open()
				.then(() => new Adb.WebUSB.Transport(device)));
	};

	Adb.WebUSB.Transport.prototype.close = function() {
		this.device.close();
	};

	Adb.WebUSB.Transport.prototype.reset = function() {
		this.device.reset();
	};

	Adb.WebUSB.Transport.prototype.send = function(ep, data) {
		if (Adb.Opt.dump)
			hexdump(new DataView(data), "" + ep + "==> ");

		return this.device.transferOut(ep, data);
	};

	Adb.WebUSB.Transport.prototype.receive = function(ep, len) {
		return this.device.transferIn(ep, len)
			.then(response => {
				if (Adb.Opt.dump)
					hexdump(response.data, "<==" + ep + " ");

				return response.data;
			});
	};

	Adb.WebUSB.Transport.prototype.find = function(filter) {
		for (let i in this.device.configurations) {
			let conf = this.device.configurations[i];
			for (let j in conf.interfaces) {
				let intf = conf.interfaces[j];
				for (let k in intf.alternates) {
					let alt = intf.alternates[k];
					if (filter.classCode == alt.interfaceClass &&
					    filter.subclassCode == alt.interfaceSubclass &&
					    filter.protocolCode == alt.interfaceProtocol) {
						return { conf: conf, intf: intf, alt: alt };
					}
				}
			}
		}

		return null;
	}

	Adb.WebUSB.Transport.prototype.isAdb = function() {
		let match = this.find({ classCode: 255, subclassCode: 66, protocolCode: 1 });
		return match != null;
	};

	Adb.WebUSB.Transport.prototype.isFastboot = function() {
		let match = this.find({ classCode: 255, subclassCode: 66, protocolCode: 3 });
		return match != null;
	};

	Adb.WebUSB.Transport.prototype.getDevice = function(filter) {
		let match = this.find(filter);
		return this.device.selectConfiguration(match.conf.configurationValue)
			.then(() => this.device.claimInterface(match.intf.interfaceNumber))
			.then(() => this.device.selectAlternateInterface(match.intf.interfaceNumber, match.alt.alternateSetting))
			.then(() => match);
	};

	Adb.WebUSB.Transport.prototype.connectAdb = function(banner, auth_user_notify = null) {
		let VERSION = 0x01000000;
		let VERSION_NO_CHECKSUM = 0x01000001;
		let MAX_PAYLOAD = 256 * 1024;

		let key_idx = 0;
		let AUTH_TOKEN = 1;

		let version_used = Adb.Opt.use_checksum ? VERSION : VERSION_NO_CHECKSUM;
		let m = new Adb.Message("CNXN", version_used, MAX_PAYLOAD, "" + banner + "\0");
		return this.getDevice({ classCode: 255, subclassCode: 66, protocolCode: 1 })
			.then(match => new Adb.WebUSB.Device(this, match))
			.then(adb => m.send_receive(adb)
				.then((function do_auth_response(response) {
					if (response.cmd != "AUTH" || response.arg0 != AUTH_TOKEN)
						return response;

					return keys.then(keys =>
						do_auth(adb, keys, key_idx++, response.data.buffer, do_auth_response, auth_user_notify));
				}))
				.then(response => {
					if (response.cmd != "CNXN")
						throw new Error("Failed to connect with '" + banner + "'");
					console.log('version', response.arg0);
					if (response.arg0 != VERSION && response.arg0 != VERSION_NO_CHECKSUM)
						throw new Error("Version mismatch: " + response.arg0 + " (expected: " + VERSION + " or " + VERSION_NO_CHECKSUM + ")");
					if (Adb.Opt.debug)
						console.log("Connected with '" + banner + "', max_payload: " + response.arg1);
					adb.max_payload = response.arg1;
					if (response.arg0 == VERSION_NO_CHECKSUM)
						Adb.Opt.use_checksum = false;
					adb.banner = new TextDecoder("utf-8").decode(response.data);
					let pieces = adb.banner.split(':');
					adb.mode = pieces[0];
					return adb;
				})
			);
	};

	Adb.WebUSB.Transport.prototype.connectFastboot = function() {
		return this.getDevice({ classCode: 255, subclassCode: 66, protocolCode: 3 })
			.then(match => new Fastboot.WebUSB.Device(this, match))
			.then(fastboot => fastboot.send("getvar:max-download-size")
				.then(() => fastboot.receive()
					.then(response => {
						let cmd = decode_cmd(response.getUint32(0, true));
						if (cmd == "FAIL")
							throw new Error("Unable to open Fastboot");

						fastboot.get_cmd = r => decode_cmd(r.getUint32(0, true));
						fastboot.get_payload = r => r.buffer.slice(4);
						return fastboot;
					})
				)
			);
	};

	Adb.WebUSB.Device = function(transport, match) {
		this.transport = transport;
		this.max_payload = 4096;

		this.ep_in = get_ep_num(match.alt.endpoints, "in");
		this.ep_out = get_ep_num(match.alt.endpoints, "out");

		this.transport.reset();
	}

	Adb.WebUSB.Device.prototype.open = function(service) {
		return Adb.Stream.open(this, service);
	};

	Adb.WebUSB.Device.prototype.shell = function(command) {
		return Adb.Stream.open(this, "shell:" + command);
	};

	Adb.WebUSB.Device.prototype.tcpip = function(port) {
		return Adb.Stream.open(this, "tcpip:" + port);
	};

	Adb.WebUSB.Device.prototype.sync = function() {
		return Adb.Stream.open(this, "sync:");
	};

	Adb.WebUSB.Device.prototype.reboot = function(command="") {
		return Adb.Stream.open(this, "reboot:" + command);
	};

	Adb.WebUSB.Device.prototype.send = function(data) {
		if (typeof data === "string") {
			let encoder = new TextEncoder();
			let string_data = data;
			data = encoder.encode(string_data).buffer;
		}

		if (data != null && data.length > this.max_payload)
			throw new Error("data is too big: " + data.length + " bytes (max: " + this.max_payload + " bytes)");

		return this.transport.send(this.ep_out, data);
	};

	Adb.WebUSB.Device.prototype.receive = function(len) {
		return this.transport.receive(this.ep_in, len);
	};

	let Fastboot = {};
	Fastboot.WebUSB = {};

	Fastboot.WebUSB.Device = function(transport, match) {
		this.transport = transport;
		this.max_datasize = 64;

		this.ep_in = get_ep_num(match.alt.endpoints, "in");
		this.ep_out = get_ep_num(match.alt.endpoints, "out");
	};

	Fastboot.WebUSB.Device.prototype.send = function(data) {
		if (typeof data === "string") {
			let encoder = new TextEncoder();
			let string_data = data;
			data = encoder.encode(string_data).buffer;
		}

		if (data != null && data.length > this.max_datasize)
			throw new Error("data is too big: " + data.length + " bytes (max: " + this.max_datasize + " bytes)");

		return this.transport.send(this.ep_out, data);
	};

	Fastboot.WebUSB.Device.prototype.receive = function() {
		return this.transport.receive(this.ep_in, 64);
	};

	Adb.Message = function(cmd, arg0, arg1, data = null) {
		if (cmd.length != 4)
			throw new Error("Invalid command: '" + cmd + "'");

		this.cmd = cmd;
		this.arg0 = arg0;
		this.arg1 = arg1;
		this.length = (data === null) ? 0 : (typeof data === "string") ? data.length : data.byteLength;
		this.data = data;
	};

	Adb.Message.checksum = function(data_view) {
		let sum = 0;

		for (let i = 0; i < data_view.byteLength; i++)
			sum += data_view.getUint8(i);

		return sum & 0xffffffff;
	};

	Adb.Message.send = function(device, message) {
		let header = new ArrayBuffer(24);
		let cmd = encode_cmd(message.cmd);
		let magic = cmd ^ 0xffffffff;
		let data = null;
		let len = 0;
		let checksum = 0;

		if (Adb.Opt.debug)
			console.log(message);

		if (message.data != null) {
			if (typeof message.data === "string") {
				let encoder = new TextEncoder();
				data = encoder.encode(message.data).buffer;
			} else if (ArrayBuffer.isView(message.data)) {
				data = message.data.buffer;
			} else {
				data = message.data;
			}

			len = data.byteLength;
			if (Adb.Opt.use_checksum)
				checksum = Adb.Message.checksum(new DataView(data));

			if (len > device.max_payload)
				throw new Error("data is too big: " + len + " bytes (max: " + device.max_payload + " bytes)");
		}

		let view = new DataView(header);
		view.setUint32(0, cmd, true);
		view.setUint32(4, message.arg0, true);
		view.setUint32(8, message.arg1, true);
		view.setUint32(12, len, true);
		view.setUint32(16, checksum, true);
		view.setUint32(20, magic, true);

		let seq = device.send(header);
		if (len > 0)
			seq.then(() => device.send(data));
		return seq;
	};

	Adb.Message.receive = function(device) {
		return device.receive(24) //Adb.Opt.use_checksum ? 24 : 20)
			.then(response => {
				let cmd = response.getUint32(0, true);
				let arg0 = response.getUint32(4, true);
				let arg1 = response.getUint32(8, true);
				let len = response.getUint32(12, true);
				let check = response.getUint32(16, true);
				// Android seems to have stopped providing checksums
				if (Adb.use_checksum && response.byteLength > 20) {
					let magic = response.getUint32(20, true);

					if ((cmd ^ magic) != -1)
						throw new Error("magic mismatch");
				}

				cmd = decode_cmd(cmd);

				if (len == 0) {
					let message = new Adb.Message(cmd, arg0, arg1);
					if (Adb.Opt.debug)
						console.log(message);
					return message;
				}

				return device.receive(len)
					.then(data => {
						if (Adb.Opt.use_checksum && Adb.Message.checksum(data) != check)
							throw new Error("checksum mismatch");

						let message = new Adb.Message(cmd, arg0, arg1, data);
						if (Adb.Opt.debug)
							console.log(message);
						return message;
					});
			});
	};

	Adb.Message.prototype.send = function(device) {
		return Adb.Message.send(device, this);
	};

	Adb.Message.prototype.send_receive = function(device) {
		return this.send(device)
			.then(() => Adb.Message.receive(device));
	};

	Adb.SyncFrame = function(cmd, length = 0, data = null) {
		if (cmd.length != 4)
			throw new Error("Invalid command: '" + cmd + "'");

		this.cmd = cmd;
		this.length = length;
		this.data = data;
	};

	Adb.SyncFrame.send = function(stream, frame) {
		let data = new ArrayBuffer(8);
		let cmd = encode_cmd(frame.cmd);

		if (Adb.Opt.debug)
			console.log(frame);

		let view = new DataView(data);
		view.setUint32(0, cmd, true);
		view.setUint32(4, frame.length, true);

		return stream.send("WRTE", data);
	};

	Adb.SyncFrame.receive = function(stream) {
		return stream.receive()
			.then(response => {
				if (response.cmd == "WRTE") {
					let cmd = decode_cmd(response.data.getUint32(0, true));

					if (cmd == "OKAY" || cmd == "DATA" || cmd == "DONE" || cmd == "FAIL") {
						let len = response.data.getUint32(4, true);
						let data = new DataView(response.data.buffer.slice(8));

						if (len == 0 || data.byteLength >= len) {
							let frame = new Adb.SyncFrame(cmd, len, data);
							if (Adb.Opt.debug)
								console.log(frame);
							return frame;
						}

						return stream.send("OKAY")
							.then(() => stream.receive())
							.then(response => {
								if (response.data == null) {
									let frame = new Adb.SyncFrame(cmd);
									if (Adb.Opt.debug)
										console.log(frame);
									return frame;
								}

								let cmd2 = decode_cmd(response.data.getUint32(0, true));

								if (cmd2 == "OKAY" || cmd2 == "DATA" || cmd2 == "DONE" || cmd2 == "FAIL") {
									let len = response.data.getUint32(4, true);
									let data = new DataView(response.data.buffer.slice(8));

									if (len == 0 || data.byteLength >= len) {
										let frame = new Adb.SyncFrame(cmd2, len, data);
										if (Adb.Opt.debug)
											console.log(frame);
										return frame;
									}
								}

								if (response.data.byteLength < len)
									throw new Error("expected at least " + len + ", got " + response.data.byteLength);

								let frame = new Adb.SyncFrame(cmd, len, response.data);
								if (Adb.Opt.debug)
									console.log(frame);
								return frame;
							});
					}

					if (Adb.Opt.debug)
						console.log(response);
					if (Adb.Opt.dump)
						hexdump(response.data, "WRTE: ");

					throw new Error("invalid WRTE frame");
				}

				if (response.cmd == "OKAY") {
					let frame = new Adb.SyncFrame("OKAY");
					if (Adb.Opt.debug)
						console.log(frame);
					return frame;
				}

				if (Adb.Opt.debug)
					console.log(response);

				throw new Error("invalid SYNC frame");
			});
	};

	Adb.SyncFrame.prototype.send = function(stream) {
		return Adb.SyncFrame.send(stream, this);
	};

	Adb.SyncFrame.prototype.send_receive = function(stream) {
		return Adb.SyncFrame.send(stream, this)
			.then(() => Adb.SyncFrame.receive(stream));
	};

	Adb.Stream = function(device, service, local_id, remote_id) {
		this.device = device;
		this.service = service;
		this.local_id = local_id;
		this.remote_id = remote_id;
		this.cancel = null;
	};

	let next_id = 1;

	Adb.Stream.open = function(device, service) {
		let local_id = next_id++;
		let remote_id = 0;

		let m = new Adb.Message("OPEN", local_id, remote_id, "" + service + "\0");
		return m.send_receive(device)
			.then(function do_response(response) {
				if (response.arg1 != local_id)
					return Adb.Message.receive(device).then(do_response);

				if (response.cmd != "OKAY")
					throw new Error("Open failed");

				remote_id = response.arg0;

				if (Adb.Opt.debug) {
					console.log("Opened stream '" + service + "'");
					console.log(" local_id: 0x" + toHex32(local_id));
					console.log(" remote_id: 0x" + toHex32(remote_id));
				}

				return new Adb.Stream(device, service, local_id, remote_id);
			});
	};

	Adb.Stream.prototype.close = function() {
		if (this.local_id != 0) {
			this.local_id = 0;
			return this.send("CLSE");
		}

		if (Adb.Opt.debug) {
			console.log("Closed stream '" + this.service + "'");
			console.log(" local_id: 0x" + toHex32(this.local_id));
			console.log(" remote_id: 0x" + toHex32(this.remote_id));
		}

		this.service = "";
		this.remote_id = 0;
	};

	Adb.Stream.prototype.send = function(cmd, data=null) {
		let m = new Adb.Message(cmd, this.local_id, this.remote_id, data);
		return m.send(this.device);
	};

	Adb.Stream.prototype.receive = function() {
		return Adb.Message.receive(this.device)
			.then(response => {
				// remote's prospective of local_id/remote_id is reversed
				if (response.arg0 != 0 && response.arg0 != this.remote_id)
					throw new Error("Incorrect arg0: 0x" + toHex32(response.arg0) + " (expected 0x" + toHex32(this.remote_id) + ")");
				if (this.local_id != 0 && response.arg1 != this.local_id)
					throw new Error("Incorrect arg1: 0x" + toHex32(response.arg1) + " (expected 0x" + toHex32(this.local_id) + ")");
				return response;
			});
	};

	Adb.Stream.prototype.send_receive = function(cmd, data=null) {
		return this.send(cmd, data)
			.then(() => this.receive());
	};

	Adb.Stream.prototype.abort = function() {
		if (Adb.Opt.debug)
			console.log("aborting...");

		let self = this;
		return new Promise(function(resolve, reject) {
			self.cancel = function() {
				if (Adb.Opt.debug)
					console.log("aborted");
				self.cancel = null;
				resolve();
			};
		});
	};

	Adb.Stream.prototype.stat = function(filename) {
		let frame = new Adb.SyncFrame("STAT", filename.length);
		return frame.send_receive(this)
			.then(check_ok("STAT failed on " + filename))
			.then(response => {
				let encoder = new TextEncoder();
				return this.send_receive("WRTE", encoder.encode(filename))
			})
			.then(check_ok("STAT failed on " + filename))
			.then(response => {
				return this.receive().then(response =>
					this.send("OKAY").then(() =>
					response.data));
			})
			.then(response => {
				let id = decode_cmd(response.getUint32(0, true));
				let mode = response.getUint32(4, true);
				let size = response.getUint32(8, true);
				let time = response.getUint32(12, true);

				if (Adb.Opt.debug) {
					console.log("STAT: " + filename);
					console.log("id: " + id);
					console.log("mode: " + mode);
					console.log("size: " + size);
					console.log("time: " + time);
				}

				if (id != "STAT")
					throw new Error("STAT failed on " + filename);

				return { mode: mode, size: size, time: time };
			});
	};

	Adb.Stream.prototype.pull = function(filename) {
		let frame = new Adb.SyncFrame("RECV", filename.length);
		return frame.send_receive(this)
			.then(check_ok("PULL RECV failed on " + filename))
			.then(response => {
				let encoder = new TextEncoder();
				return this.send_receive("WRTE", encoder.encode(filename))
			})
			.then(check_ok("PULL WRTE failed on " + filename))
			.then(() => Adb.SyncFrame.receive(this))
			.then(check_cmd("DATA", "PULL DATA failed on " + filename))
			.catch(err => {
				return this.send("OKAY")
					.then(() => { throw err; });
			})
			.then(response => {
				return this.send("OKAY")
					.then(() => response);
			})
			.then(response => {
				let len = response.length;
				if (response.data.byteLength == len + 8) {
					let cmd = response.data.getUint32(len, true);
					let zero = response.data.getUint32(len + 4, true);
					if (decode_cmd(cmd) != "DONE" || zero != 0)
						throw new Error("PULL DONE failed on " + filename);

					return new DataView(response.data.buffer, 0, len);
				}

				if (response.data.byteLength > 64 * 1024) {
					let cmd = response.data.getUint32(response.data.byteLength - 8, true);
					let zero = response.data.getUint32(response.data.byteLength - 4, true);
					if (decode_cmd(cmd) != "DONE" || zero != 0)
						throw new Error("PULL DONE failed on " + filename);

					return new DataView(response.data.buffer, 0, response.data.byteLength - 8);
				}

				if (response.data.byteLength != len)
				  throw new Error("PULL DATA failed on " + filename + ": " + response.data.byteLength + "!=" + len);

				return this.receive()
					.then(response => {
						let cmd = response.data.getUint32(0, true);
						let zero = response.data.getUint32(4, true);
						if (decode_cmd(cmd) != "DONE" || zero != 0)
							throw new Error("PULL DONE failed on " + filename);
					})
					.then(() => this.send("OKAY"))
					.then(() => response.data);
			});
	};

	Adb.Stream.prototype.push_start = function(filename, mode) {
		let mode_str = mode.toString(10);
		let encoder = new TextEncoder();

		let frame = new Adb.SyncFrame("SEND", filename.length + 1 + mode_str.length);
		return frame.send_receive(this)
			.then(check_ok("PUSH failed on " + filename))
			.then(response => {
				return this.send("WRTE", encoder.encode(filename))
			})
			.then(() => Adb.SyncFrame.receive(this))
			.then(check_ok("PUSH failed on " + filename))
			.then(response => {
				return this.send("WRTE", encoder.encode("," + mode_str))
			})
			.then(() => Adb.SyncFrame.receive(this))
			.then(check_ok("PUSH failed on " + filename));
	};

	Adb.Stream.prototype.push_data = function(data) {
		if (typeof data === "string") {
			let encoder = new TextEncoder();
			let string_data = data;
			data = encoder.encode(string_data).buffer;
		} else if (ArrayBuffer.isView(data)) {
			data = data.buffer;
		}

		let frame = new Adb.SyncFrame("DATA", data.byteLength);
		return frame.send_receive(this)
			.then(check_ok("PUSH failed"))
			.then(response => {
				return this.send("WRTE", data);
			})
			.then(() => Adb.SyncFrame.receive(this))
			.then(check_ok("PUSH failed"));
	};

	Adb.Stream.prototype.push_done = function() {
		let frame = new Adb.SyncFrame("DONE", Math.round(Date.now() / 1000));
		return frame.send_receive(this)
			.then(check_ok("PUSH failed"))
			.then(response => {
				return Adb.SyncFrame.receive(this);
			})
			.then(check_ok("PUSH failed"))
			.then(response => {
				return this.send("OKAY");
			});
	};

	Adb.Stream.prototype.push = function(file, filename, mode, on_progress = null) {
		// we need reduced logging during the data transfer otherwise the console may explode
		let old_debug = Adb.Opt.debug;
		let old_dump = Adb.Opt.dump;
		Adb.Opt.debug = false;
		Adb.Opt.dump = false;

		// read the whole file
		return read_blob(file).then(data =>
			this.push_start(filename, mode).then(() => {
				let seq = Promise.resolve();
				let rem = file.size;
				let max = Math.min(0x10000, this.device.max_payload);
				while (rem > 0) {
					// these two are needed here for the closure
					let len = Math.min(rem, max);
					let count = file.size - rem;
					seq = seq.then(() => {
						if (this.cancel) {
							Adb.Opt.debug = old_debug;
							Adb.Opt.dump = old_dump;
							this.cancel();
							throw new Error("cancelled");
						}
						if (on_progress != null)
							on_progress(count, file.size);
						return this.push_data(data.slice(count, count + len));
					});
					rem -= len;
				}
				return seq.then(() => {
					Adb.Opt.debug = old_debug;
					Adb.Opt.dump = old_dump;
					return this.push_done();
				});
			}));
	};

	Adb.Stream.prototype.quit = function() {
		let frame = new Adb.SyncFrame("QUIT");
		return frame.send_receive(this)
			.then(check_ok("QUIT failed"))
			.then(response => {
				return this.receive();
			})
			.then(check_cmd("CLSE", "QUIT failed"))
			.then(response => {
				return this.close();
			});
	};

	function check_cmd(cmd, err_msg)
	{
		return function(response) {
			if (response.cmd == "FAIL") {
				let decoder = new TextDecoder();
				throw new Error(decoder.decode(response.data));
			}
			if (response.cmd != cmd)
				throw new Error(err_msg);
			return response;
		};
	}

	function check_ok(err_msg)
	{
		return check_cmd("OKAY", err_msg);
	}

	function paddit(text, width, padding)
	{
		let padlen = width - text.length;
		let padded = "";

		for (let i = 0; i < padlen; i++)
			padded += padding;

		return padded + text;
	}

	function toHex8(num)
	{
		return paddit(num.toString(16), 2, "0");
	}

	function toHex16(num)
	{
		return paddit(num.toString(16), 4, "0");
	}

	function toHex32(num)
	{
		return paddit(num.toString(16), 8, "0");
	}

	function toB64(buffer)
	{
		return btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ""));
	}

	function hexdump(view, prefix="")
	{
		let decoder = new TextDecoder();

		for (let i = 0; i < view.byteLength; i += 16) {
			let max = (view.byteLength - i) > 16 ? 16 : (view.byteLength - i);
			let row = prefix + toHex16(i) + " ";
			let j;

			for (j = 0; j < max; j++)
				row += " " + toHex8(view.getUint8(i + j));
			for (; j < 16; j++)
				row += "   ";

			row += " | " + decoder.decode(new DataView(view.buffer, i, max));
			console.log(row);
		}
	}

	function get_ep_num(endpoints, dir, type = "bulk")
	{
		let e, ep;
		for (e in endpoints)
			if (ep = endpoints[e], ep.direction == dir && ep.type == type)
				return ep.endpointNumber;
		if (Adb.Opt.debug)
			console.log(endpoints);
		throw new Error("Cannot find " + dir + " endpoint");
	}

	function encode_cmd(cmd)
	{
		let encoder = new TextEncoder();
		let buffer = encoder.encode(cmd).buffer;
		let view = new DataView(buffer);
		return view.getUint32(0, true);
	}

	function decode_cmd(cmd)
	{
		let decoder = new TextDecoder();
		let buffer = new ArrayBuffer(4);
		let view = new DataView(buffer);
		view.setUint32(0, cmd, true);
		return decoder.decode(buffer);
	}

	function generate_key()
	{
		let extractable = Adb.Opt.dump;

		return crypto.subtle.generateKey({
					name: "RSASSA-PKCS1-v1_5",
					modulusLength: Adb.Opt.key_size,
					publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
					hash: { name: "SHA-1" }
				}, extractable, [ "sign", "verify" ])
			.then(key => {
				if (!Adb.Opt.dump)
					return key;

				return privkey_dump(key)
					.then(() => pubkey_dump(key))
					.then(() => key);
			});
	}

	function do_auth(adb, keys, key_idx, token, do_auth_response, auth_user_notify)
	{
		let AUTH_SIGNATURE = 2;
		let AUTH_RSAPUBLICKEY = 3;

		if (key_idx < keys.length) {
			let slot = keys.length - key_idx - 1;
			let key = keys[slot];
			let seq = Promise.resolve();

			if (Adb.Opt.debug)
				console.log("signing with key " + slot + "...");
			if (Adb.Opt.dump) {
				seq = seq.then(() => privkey_dump(key))
					.then(() => pubkey_dump(key))
					.then(() => hexdump(new DataView(token)))
					.then(() => console.log("-----BEGIN TOKEN-----\n" + toB64(token) + "\n-----END TOKEN-----"));
			}

			return seq.then(() => crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key.privateKey, token))
				.then(signed => {
					if (Adb.Opt.dump)
						console.log("-----BEGIN SIGNATURE-----\n" + toB64(signed) + "\n-----END SIGNATURE-----");

					let m = new Adb.Message("AUTH", AUTH_SIGNATURE, 0, signed);
					return m.send_receive(adb).then(do_auth_response);
				});
		}

		let seq = null;
		let dirty = false;

		if (Adb.Opt.reuse_key !== false) {
			key_idx = Adb.Opt.reuse_key === true ? -1 : Adb.Opt.reuse_key;

			if (key_idx < 0)
				key_idx += keys.length;

			if (key_idx >= 0 && key_idx < keys.length) {
				if (Adb.Opt.debug)
					console.log("reusing key " + key_idx + "...");
				seq = Promise.resolve(keys[key_idx]);
			}
		}

		if (seq === null) {
			if (Adb.Opt.debug)
				console.log("generating key " + key_idx + " (" + Adb.Opt.key_size + " bits)...");

			seq = generate_key();
			dirty = true;
		}

		return seq.then(key => {
			return crypto.subtle.exportKey("spki", key.publicKey)
				.then(pubkey => {
					let m = new Adb.Message("AUTH", AUTH_RSAPUBLICKEY, 0, toB64(pubkey) + "\0");
					return m.send(adb);
				})
				.then(() => {
					if (Adb.Opt.debug)
						console.log("waiting for user confirmation...");
					if (auth_user_notify != null)
						auth_user_notify(key.publicKey);
					return Adb.Message.receive(adb);
				})
				.then(response => {
					// return response;
					if (response.cmd != "CNXN")
						return response;
					if (!dirty)
						return response;

					keys.push(key);
					return db.then(db => store_key(db, key))
						.then(() => response);
				});
		});
	}

	function privkey_dump(key)
	{
		if (!key.privateKey.extractable) {
			console.log("cannot dump the private key, it's not extractable");
			return;
		}

		return crypto.subtle.exportKey("pkcs8", key.privateKey)
			.then(privkey => console.log("-----BEGIN PRIVATE KEY-----\n" + toB64(privkey) + "\n-----END PRIVATE KEY-----"));
	}

	function pubkey_dump(key)
	{
		if (!key.publicKey.extractable) {
			console.log("cannot dump the public key, it's not extractable");
			return;
		}

		return crypto.subtle.exportKey("spki", key.publicKey)
			.then(pubkey => console.log("-----BEGIN PUBLIC KEY-----\n" + toB64(pubkey) + "\n-----END PUBLIC KEY-----"));
	}

	function read_blob(blob)
	{
		return new Promise(function(resolve, reject) {
			let reader = new FileReader();
			reader.onload = e => resolve(e.target.result);
			reader.onerror = e => reject(e.target.error);
			reader.readAsArrayBuffer(blob);
		});
	}

	function promisify(request, onsuccess = "onsuccess", onerror = "onerror")
	{
		return new Promise(function (resolve, reject) {
			request[onsuccess] = event => resolve(event.target.result);
			request[onerror] = event => reject(event.target.errorCode);
		});
	}

	function init_db()
	{
		let req = window.indexedDB.open("WebADB", 1);

		req.onupgradeneeded = function (event) {
			let db = event.target.result;

			if (Adb.Opt.debug)
				console.log("DB: migrating from version " + event.oldVersion + " to " + event.newVersion + "...");

			if (db.objectStoreNames.contains('keys')) {
				if (Adb.Opt.debug)
					console.log("DB: deleting old keys...");

				db.deleteObjectStore('keys');
			}

			db.createObjectStore("keys", { autoIncrement: true });
		};

		return promisify(req);
	}

	function load_keys(db)
	{
		let transaction = db.transaction("keys");
		let store = transaction.objectStore("keys");
		let cursor = store.openCursor();
		let keys = [];

		cursor.onsuccess = function (event) {
			let result = event.target.result;
			if (result != null) {
				keys.push(result.value);
				result.continue();
			}
		};

		return promisify(transaction, "oncomplete").then(function (result) {
			if (Adb.Opt.debug)
				console.log("DB: loaded " + keys.length + " keys");
			return keys;
		});
	}

	function store_key(db, key)
	{
		let transaction = db.transaction("keys", "readwrite");
		let store = transaction.objectStore('keys');
		let request = store.put(key);

		return promisify(request).then(function (result) {
			if (Adb.Opt.debug)
				console.log("DB: stored key " + (result - 1));
			return result;
		});
	}

	function clear_keys(db)
	{
		let transaction = db.transaction("keys", "readwrite");
		let store = transaction.objectStore("keys");
		let request = store.clear();

		return promisify(request).then(function (result) {
			if (Adb.Opt.debug)
				console.log("DB: removed all the keys");
			return result;
		});
	}

	return Adb;
}));
```

## File: css/styles.css
```css
/* --- Keep all existing CSS --- */
:root {
    /* Material Design 3 Dark Theme Tokens */
    --md-sys-color-background: #111318;
    --md-sys-color-surface: #1E2025;
    --md-sys-color-surface-variant: #44474F;
    --md-sys-color-primary: #A8C7FA;
    --md-sys-color-on-primary: #003063;
    --md-sys-color-primary-container: #00478E;
    --md-sys-color-on-primary-container: #D6E3FF;
    --md-sys-color-secondary: #5DD5FC;
    --md-sys-color-secondary-container: #004F58;
    --md-sys-color-error: #FFB4AB;
    --md-sys-color-on-surface: #E2E2E6;
    --md-sys-color-outline: #8E9099;
    --md-elevation-2: 0px 4px 8px 3px rgba(0,0,0,0.15);
    
    --border-radius-lg: 24px;
    --border-radius-pill: 50px;
}

* { box-sizing: border-box; }

body {
    font-family: 'Heebo', 'Roboto', sans-serif;
    background-color: var(--md-sys-color-background);
    color: var(--md-sys-color-on-surface);
    margin: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* --- Header & Stepper --- */
header {
    padding: 20px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--md-sys-color-surface);
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    z-index: 10;
}

.app-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--md-sys-color-primary);
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: default;
    user-select: none;
}

.stepper {
    display: flex;
    gap: 15px;
}

.step-dot {
    width: 12px;
    height: 12px;
    background-color: var(--md-sys-color-surface-variant);
    border-radius: 50%;
    transition: all 0.3s ease;
}

.step-dot.active {
    background-color: var(--md-sys-color-primary);
    transform: scale(1.3);
    box-shadow: 0 0 10px var(--md-sys-color-primary);
}

.step-dot.completed {
    background-color: var(--md-sys-color-secondary);
}

/* --- Main Layout --- */
.main-container {
    display: grid;
    grid-template-columns: 1fr 380px;
    gap: 40px;
    padding: 40px;
    height: 100%;
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
}

/* --- Left Panel (Content) --- */
.content-panel {
    position: relative;
    background: var(--md-sys-color-surface);
    border-radius: var(--border-radius-lg);
    padding: 40px;
    box-shadow: var(--md-elevation-2);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
}

.page {
    display: none;
    opacity: 0;
    transition: opacity 0.4s ease-in-out;
    height: 100%;
    flex-direction: column;
}

.page.active {
    display: flex;
    opacity: 1;
}

h2 {
    font-size: 2rem;
    margin-top: 0;
    color: var(--md-sys-color-on-surface);
}

.info-card {
    background: var(--md-sys-color-surface-variant);
    color: var(--md-sys-color-on-primary-container);
    padding: 20px;
    border-radius: 16px;
    margin-bottom: 25px;
    font-size: 1.1rem;
    display: flex;
    align-items: start;
    gap: 15px;
}

.info-card .material-symbols-rounded {
    font-size: 24px;
    color: var(--md-sys-color-primary);
}

.list-item {
    display: flex;
    align-items: center;
    padding: 12px 0;
    border-bottom: 1px solid #333;
    font-size: 1.1rem;
}

.list-item .icon {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-left: 15px;
    font-weight: bold;
    font-size: 0.9rem;
}

/* --- Account List --- */
#account-list {
    margin-top: 20px;
    background-color: rgba(183, 28, 28, 0.1);
    border: 1px solid rgba(229, 115, 115, 0.5);
    border-radius: 12px;
    padding: 10px 20px;
    color: #E57373;
}

#account-list ul {
    list-style-type: none;
    padding: 0;
    margin: 0;
}

#account-list li {
    padding: 8px 0;
    font-family: monospace;
    font-size: 1rem;
    border-bottom: 1px solid rgba(229, 115, 115, 0.2);
}

#account-list li:last-child {
    border-bottom: none;
}

/* --- Right Panel (Phone Frame) --- */
.phone-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.phone-frame {
    width: 300px;
    height: 600px;
    border: 12px solid #2d2d2d;
    border-radius: 45px;
    background: #000;
    position: relative;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
}

.phone-frame::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 120px;
    height: 25px;
    background: #2d2d2d;
    border-bottom-left-radius: 15px;
    border-bottom-right-radius: 15px;
    z-index: 5;
}

video {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.phone-controls {
    margin-top: 20px;
    display: flex;
    gap: 20px;
}

/* --- Buttons & Inputs --- */
.btn {
    background-color: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
    border: none;
    padding: 0 32px;
    height: 48px;
    border-radius: var(--border-radius-pill);
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: all 0.2s;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.btn:hover {
    box-shadow: 0 4px 12px rgba(168, 199, 250, 0.4);
    transform: translateY(-1px);
}

.btn:disabled {
    background-color: #333;
    color: #777;
    cursor: not-allowed;
    box-shadow: none;
    transform: none;
}

.btn-tonal {
    background-color: var(--md-sys-color-surface-variant);
    color: var(--md-sys-color-on-surface);
}

.btn-tonal:hover {
    background-color: #555;
}

.action-area {
    margin-top: auto;
    padding-top: 30px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--md-sys-color-surface-variant);
}

.status-badge {
    background: rgba(255,255,255,0.05);
    padding: 8px 16px;
    border-radius: 12px;
    font-family: monospace;
    color: var(--md-sys-color-outline);
    display: flex;
    align-items: center;
    gap: 8px;
}

.status-badge.success { color: #81C784; background: rgba(27, 94, 32, 0.2); }
.status-badge.error { color: #E57373; background: rgba(183, 28, 28, 0.2); }

/* --- Terminal / Log --- */
.terminal {
    background: #0d0d0d;
    color: #e0e0e0;
    font-family: 'Consolas', monospace;
    padding: 15px;
    border-radius: 12px;
    height: 250px; /* Increased height */
    overflow-y: auto;
    font-size: 0.85rem;
    border: 1px solid #333;
    line-height: 1.4;
}

.log-entry {
    margin-bottom: 4px;
    border-left: 3px solid transparent;
    padding-left: 10px;
}

.log-info { color: #8e9099; }
.log-success { color: #81C784; border-left-color: #4CAF50; }
.log-error { 
    color: #FFB4AB; 
    background: rgba(255, 180, 171, 0.1); 
    border-left-color: #CF6679;
    padding: 8px;
    font-weight: bold;
}

/* --- Snackbar --- */
#snackbar {
    visibility: hidden;
    min-width: 250px;
    background-color: #333;
    color: #fff;
    text-align: center;
    border-radius: 8px;
    padding: 16px;
    position: fixed;
    z-index: 100;
    left: 50%;
    bottom: 30px;
    transform: translateX(-50%);
    box-shadow: 0 4px 15px rgba(0,0,0,0.5);
    font-size: 1rem;
}
#snackbar.show { visibility: visible; animation: fadein 0.5s, fadeout 0.5s 2.5s; }

@keyframes fadein { from {bottom: 0; opacity: 0;} to {bottom: 30px; opacity: 1;} }
@keyframes fadeout { from {bottom: 30px; opacity: 1;} to {bottom: 0; opacity: 0;} }

/* --- ProgressBar --- */
.progress-wrapper {
    width: 100%;
    background: #333;
    height: 6px;
    border-radius: 3px;
    margin: 20px 0;
    overflow: hidden;
    display: none;
}
.progress-fill {
    height: 100%;
    width: 0%;
    background: var(--md-sys-color-primary);
    transition: width 0.3s ease;
}

/* --- Compatibility Notice --- */
#compatibility-notice {
    display: none;
    text-align: center;
    padding: 30px;
    background-color: var(--md-sys-color-surface-variant);
    border-radius: var(--border-radius-lg);
}

/* --- DEVELOPER MODE CONSOLE (NEW) --- */
#dev-console {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 500px;
    background: #000;
    border: 1px solid #00ff00;
    box-shadow: 0 0 20px rgba(0, 255, 0, 0.1);
    border-radius: 8px;
    z-index: 9999;
    font-family: 'Consolas', monospace;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.dev-header {
    background: #002200;
    color: #00ff00;
    padding: 8px 12px;
    font-weight: bold;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #00ff00;
}

.dev-log {
    height: 250px;
    overflow-y: auto;
    padding: 10px;
    color: #ccc;
    font-size: 12px;
}

.dev-log-entry { margin-bottom: 5px; border-bottom: 1px solid #222; padding-bottom: 2px; }
.dev-log-entry.cmd { color: #ffff00; }
.dev-log-entry.resp { color: #00ffff; }
.dev-log-entry.waiting { color: #ff00ff; animation: pulse 1s infinite; }

.dev-controls {
    padding: 10px;
    background: #111;
    border-top: 1px solid #333;
}

.dev-input-group {
    display: flex;
    gap: 5px;
    margin-bottom: 8px;
}

.dev-input-group input {
    flex-grow: 1;
    background: #222;
    border: 1px solid #444;
    color: #fff;
    padding: 5px;
    font-family: monospace;
}

.dev-scenarios {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
}

.dev-btn {
    background: #222;
    color: #00ff00;
    border: 1px solid #00ff00;
    padding: 4px 8px;
    font-size: 10px;
    cursor: pointer;
    text-transform: uppercase;
}

.dev-btn:hover { background: #00ff00; color: #000; }

@keyframes pulse { 0% { opacity: 0.5; } 50% { opacity: 1; } 100% { opacity: 0.5; } }

/* Mobile */
@media (max-width: 900px) {
    .main-container { grid-template-columns: 1fr; padding: 20px; overflow-y: scroll; display: block; }
    .phone-panel { display: none; }
    header { padding: 15px 20px; }
    .app-title { font-size: 1.2rem; }
    #dev-console { width: 95%; right: 2.5%; bottom: 10px; }
}
```

## File: js/utils.js
```javascript
/* --- UI HELPER FUNCTIONS --- */

function navigateTo(pageId, stepIndex) {
    // Pre-flight checks to prevent skipping steps
    if (stepIndex > 1 && !appState.adbConnected) {
        showToast("יש לחבר מכשיר תחילה (שלב 1)");
        return;
    }
    if (stepIndex > 2 && !appState.accountsClean) {
        showToast("יש לוודא שאין חשבונות במכשיר (שלב 2)");
        return;
    }

    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // Show target page
    document.getElementById(pageId).classList.add('active');
    
    // Update Stepper
    document.querySelectorAll('.step-dot').forEach((dot, index) => {
        dot.classList.remove('active');
        dot.classList.remove('completed'); // Reset completed status
        if (index === stepIndex) dot.classList.add('active');
        if (index < stepIndex) dot.classList.add('completed');
    });

    // --- VIDEO SWITCHING LOGIC ---
    const video = document.getElementById('guide-video');
    const icon = document.getElementById('video-icon');
    
    let targetVideo = null;

    if (stepIndex <= 1) { // Welcome and ADB
        targetVideo = "Videos/1.mp4";
    } else if (stepIndex === 2) { // Accounts
        targetVideo = "Videos/2.mp4";
    }

    // Only switch if the source is actually changing to prevent flickering
    if (targetVideo && !video.src.includes(targetVideo)) {
        video.src = targetVideo;
        video.play().catch(e => console.log("Auto-play prevented"));
        icon.innerText = 'pause'; // Reset icon to pause since we are auto-playing
    }
    
    // Logic triggers for when a page becomes active
    if (pageId === 'page-update' && typeof checkForUpdates === 'function') {
        checkForUpdates();
    }
    if (pageId === 'page-accounts' && typeof checkAccounts === 'function') {
        // Automatically trigger a check when navigating to this page if ADB is connected
        if (appState.adbConnected) checkAccounts();
    }
}

function showToast(message) {
    const x = document.getElementById("snackbar");
    x.innerText = message;
    x.className = "show";
    setTimeout(function(){ x.className = x.className.replace("show", ""); }, 3000);
}

function toggleVideo() {
    const vid = document.getElementById('guide-video');
    const icon = document.getElementById('video-icon');
    if (vid.paused) {
        vid.play();
        icon.innerText = 'pause';
    } else {
        vid.pause();
        icon.innerText = 'play_arrow';
    }
}

function updateStatusBadge(id, text, type) {
    const el = document.getElementById(id);
    el.innerHTML = text;
    el.className = 'status-badge ' + type;
}

function updateProgress(val) {
    const bar = document.getElementById('install-progress-bar');
    if(bar) bar.style.width = (val * 100) + "%";
}

function log(text, type = 'info') {
    const el = document.getElementById('install-log');
    if(el) {
        const div = document.createElement('div');
        div.className = `log-entry log-${type}`;
        
        // Handle multiline and sanitization
        const sanitized = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        div.innerHTML = sanitized.replace(/\n/g, '<br>');
        
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    }
}

function checkBrowserCompatibility() {
    if ('usb' in navigator) {
        // WebUSB is supported
        return true;
    }
    
    // WebUSB is not supported
    document.getElementById('page-main-content').style.display = 'none';
    document.getElementById('compatibility-notice').style.display = 'block';
    return false;
}

// Run compatibility check on page load
document.addEventListener('DOMContentLoaded', checkBrowserCompatibility);
```

## File: README.md
```markdown
# a-bloq-installer
a web installer to install a bloq mdm solution,
its built to be  a static site on github pages.
```

## File: index.html
```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">    
    <meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.github.com; object-src 'none';">
    <title>מתקין A-Bloq</title>
    
    <!-- Google Fonts & Material Icons -->
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&family=Heebo:wght@300;400;700&display=swap" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0,0" rel="stylesheet" />
    
    <!-- Custom CSS -->
    <link rel="stylesheet" href="css/styles.css">

    <!-- WebADB Library -->
    <script src="js/webadb.js"></script>
</head>
<body>

    <header>
        <div class="app-title" onclick="triggerDevModeSecret()">
            <span class="material-symbols-rounded">security</span>
            מתקין A-Bloq
        </div>
        <div class="stepper">
            <div class="step-dot active" id="dot-0"></div>
            <div class="step-dot" id="dot-1"></div>
            <div class="step-dot" id="dot-2"></div>
            <div class="step-dot" id="dot-3"></div>
            <div class="step-dot" id="dot-4"></div>
        </div>
    </header>

    <div class="main-container">
        <!-- ... [Content Panel content remains exactly the same as original] ... -->
        <div class="content-panel">

            <!-- PAGE 0: Welcome -->
            <div id="page-main" class="page active" style="justify-content: center; align-items: center; text-align: center;">
                <div id="page-main-content">
                    <span class="material-symbols-rounded" style="font-size: 80px; color: var(--md-sys-color-primary); margin-bottom: 20px;">android</span>
                    <h2>ברוכים הבאים</h2>
                    <p style="color: var(--md-sys-color-outline); max-width: 400px; margin-bottom: 40px;">
                        כלי זה יסייע לכם להתקין ולהגדיר את A-Bloq על מכשיר האנדרואיד שלכם בקלות ובמהירות.
                    </p>
                    <button class="btn" onclick="navigateTo('page-adb', 1)">
                        התחל תהליך
                        <span class="material-symbols-rounded">arrow_back</span>
                    </button>
                    <!-- Dev Trigger hidden hint -->
                    <div style="margin-top:20px; font-size: 0.8rem; color: #333; cursor: pointer;" onclick="window.enableDevMode()">[ Enable Dev Mode ]</div>
                </div>
                <div id="compatibility-notice">
                    <span class="material-symbols-rounded" style="font-size: 80px; color: var(--md-sys-color-error); margin-bottom: 20px;">browser_updated</span>
                    <h2>דפדפן לא נתמך</h2>
                    <p style="color: var(--md-sys-color-outline); max-width: 400px; margin-bottom: 40px;">
                        התקנה זו דורשת תמיכה ב-WebUSB. אנא השתמש בדפדפן עדכני כגון Google Chrome, Microsoft Edge, או Opera.
                    </p>
                </div>
            </div>

            <!-- PAGE 1: ADB -->
            <div id="page-adb" class="page">
                <h2>חיבור למחשב</h2>
                <div class="info-card">
                    <span class="material-symbols-rounded">usb</span>
                    <div>יש להפעיל "אפשרויות מפתחים" ו"ניפוי באגים ב-USB" כדי לאפשר לתוכנה לתקשר עם המכשיר.</div>
                </div>

                <div style="flex-grow: 1;">
                    <div class="list-item"><div class="icon">1</div> חברו את המכשיר למחשב באמצעות כבל USB</div>
                    <div class="list-item"><div class="icon">2</div> הכנסו להגדרות -> מידע על המכשיר</div>
                    <div class="list-item"><div class="icon">3</div> לחצו 7 פעמים על "מספר Build"</div>
                    <div class="list-item"><div class="icon">4</div> חזרו למערכת -> אפשרויות מפתחים</div>
                    <div class="list-item"><div class="icon">5</div> הפעילו את "ניפוי באגים ב-USB"</div>
                    <div class="list-item" style="color: var(--md-sys-color-primary);">
                        <div class="icon" style="background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary);">!</div>
                        בחלון שיופיע במכשיר, סמנו "אפשר תמיד ממחשב זה" ואשרו.
                    </div>
                </div>

                <div class="action-area">
                    <div id="adb-status" class="status-badge">
                        <span class="material-symbols-rounded">link_off</span> לא מחובר
                    </div>
                    <div>
                        <button id="btn-connect" class="btn" onclick="connectAdb()">חבר מכשיר</button>
                        <button id="btn-next-adb" class="btn" onclick="navigateTo('page-accounts', 2)" disabled style="display:none;">
                            הבא <span class="material-symbols-rounded">arrow_back</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- PAGE 2: Accounts -->
            <div id="page-accounts" class="page">
                <h2>בדיקת חשבונות</h2>
                <div class="info-card" style="background: rgba(255, 180, 171, 0.1); color: #ffb4ab;">
                    <span class="material-symbols-rounded" style="color: #ffb4ab;">warning</span>
                    <div>חובה להסיר את כל חשבונות Google/Samsung מהמכשיר זמנית. ניתן להחזיר אותם לאחר ההתקנה.</div>
                </div>

                <div class="list-item"><div class="icon">1</div> הכנסו להגדרות -> חשבונות וגיבוי -> נהל חשבונות</div>
                <div class="list-item"><div class="icon">2</div> בחרו כל חשבון והקישו "הסר חשבון"</div>
                
                <div id="account-list"></div>

                <div style="flex-grow: 1; text-align: center; color: var(--md-sys-color-outline); padding-top: 20px;">
                    ההתקנה תיכשל אם יימצא חשבון פעיל במכשיר.
                </div>

                <div class="action-area">
                    <div id="account-status" class="status-badge">
                        <span class="material-symbols-rounded">pending</span> ממתין לבדיקה
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-tonal" onclick="checkAccounts()">
                            <span class="material-symbols-rounded">refresh</span> בדוק שוב
                        </button>
                        <button id="btn-next-acc" class="btn" onclick="navigateTo('page-update', 3)" disabled>
                            הבא <span class="material-symbols-rounded">arrow_back</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- PAGE 3: Update -->
            <div id="page-update" class="page">
                <h2>עדכון גרסה</h2>
                <div class="info-card">
                    <span class="material-symbols-rounded">cloud_download</span>
                    <div id="update-info-text">יוצר קשר עם שרתי GitHub...</div>
                </div>

                <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: center; align-items: center;">
                    <h3 id="dl-status-text" style="font-weight: 300; margin: 0;"></h3>
                    <div class="progress-wrapper" id="dl-progress-wrapper">
                        <div class="progress-fill" id="dl-progress-bar"></div>
                    </div>
                </div>

                <div class="action-area">
                    <button class="btn btn-tonal" onclick="navigateTo('page-install', 4)">דלג והשתמש בגרסה קיימת</button>
                    <button id="btn-download" class="btn" onclick="startDownload()" disabled>
                        <span class="material-symbols-rounded">download</span> הורד ועדכן
                    </button>
                </div>
            </div>

            <!-- PAGE 4: Install -->
            <div id="page-install" class="page">
                <h2>התקנה והגדרות</h2>
                <div class="terminal" id="install-log"></div>

                <div class="progress-wrapper" id="install-progress-wrapper" style="display: block;">
                    <div class="progress-fill" id="install-progress-bar"></div>
                </div>

                <div class="action-area">
                    <div class="status-badge">
                        <span class="material-symbols-rounded">terminal</span> Console
                    </div>
                    <button id="btn-install-start" class="btn" onclick="runInstallation()">
                        <span class="material-symbols-rounded">play_arrow</span> התחל התקנה
                    </button>
                </div>
            </div>

        </div>
        <!-- ... [End Content Panel] ... -->

        <!-- RIGHT PANEL (PHONE) -->
        <div class="phone-panel">
            <div class="phone-frame">
                <video id="guide-video" src="Videos/1.mp4" loop muted playsinline></video>
            </div>
            <div class="phone-controls">
                <button class="btn btn-tonal" onclick="toggleVideo()" style="border-radius: 50%; width: 50px; height: 50px; padding: 0;">
                    <span class="material-symbols-rounded" id="video-icon">play_arrow</span>
                </button>
            </div>
            <p style="color: var(--md-sys-color-outline); font-size: 0.9rem;">סרטון הדרכה (ייתכנו שינויים בין דגמים)</p>
        </div>

    </div>

    <!-- MOCK DEVICE CONTROLLER (Injected via JS, but structure here for reference) -->
    <!-- See js/app.js for the dynamic insertion of #dev-console -->

    <!-- Snackbar for Notifications -->
    <div id="snackbar">הודעה כללית</div>

    <!-- SCRIPTS -->
    <script src="js/app.js"></script>
    <script src="js/utils.js"></script>
</body>
</html>
```

## File: js/app.js
```javascript
// --- CONFIGURATION ---
const GITHUB_USERNAME = "sesese1234"; 
const GITHUB_REPO_NAME = "SecureGuardMDM"; 
const TARGET_PACKAGE = "com.secureguard.mdm";
const DEVICE_ADMIN = ".SecureGuardDeviceAdminReceiver";

// --- GLOBAL STATE ---
let adb;
let webusb;
let apkBlob = null;
let foundRelease = null; 

const appState = {
    adbConnected: false,
    accountsClean: false,
    apkDownloaded: false
};

// --- DEV MODE & MOCK INFRASTRUCTURE ---
window.DEV_MODE = false;
let mockResolver = null; // Function to resolve the pending command

// UI Builder for Dev Console
function initDevConsole() {
    if(document.getElementById('dev-console')) return;

    const html = `
    <div id="dev-console">
        <div class="dev-header">
            <span>[MOCK DEVICE TERMINAL]</span>
            <span style="font-size:10px; cursor:pointer;" onclick="document.getElementById('dev-console').style.display='none'">X</span>
        </div>
        <div id="dev-log" class="dev-log"></div>
        <div class="dev-controls">
            <div class="dev-input-group">
                <input type="text" id="dev-manual-input" placeholder="Type manual response here...">
                <button class="dev-btn" onclick="devSendManual()">SEND</button>
            </div>
            <div style="font-size:10px; color:#666; margin-bottom:4px;">PRESETS:</div>
            <div class="dev-scenarios">
                <button class="dev-btn" onclick="devPreset('success')">CMD Success</button>
                <button class="dev-btn" onclick="devPreset('model')">Model Info</button>
                <button class="dev-btn" onclick="devPreset('no_acc')">No Accounts</button>
                <button class="dev-btn" onclick="devPreset('has_acc')">Has Accounts</button>
                <button class="dev-btn" onclick="devPreset('install_ok')">Install OK</button>
                <button class="dev-btn" onclick="devPreset('dpm_ok')">Owner OK</button>
                <button class="dev-btn" onclick="devPreset('error')">Generic Error</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    devLog("System initialized. Waiting for connection...");
}

// Helpers for Dev Console
function devLog(msg, type = 'info') {
    const log = document.getElementById('dev-log');
    if(!log) return;
    const div = document.createElement('div');
    div.className = `dev-log-entry ${type}`;
    div.innerText = msg;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

window.devSendManual = function() {
    const input = document.getElementById('dev-manual-input');
    if(mockResolver) {
        devLog(`Manual Response: ${input.value}`, 'resp');
        mockResolver(input.value);
        mockResolver = null;
        input.value = '';
    } else {
        devLog("No pending command to respond to.", 'error');
    }
}

window.devPreset = function(type) {
    if(!mockResolver) return;
    let resp = "";
    switch(type) {
        case 'success': resp = "Success"; break;
        case 'model': resp = "ro.product.model: Pixel 8 Pro (Mock)"; break;
        case 'no_acc': resp = ""; break; // Empty output for accounts = clean
        case 'has_acc': resp = "Account {name=test@gmail.com, type=com.google}"; break;
        case 'install_ok': resp = "Success"; break;
        case 'dpm_ok': resp = "Success: Device owner set to package " + TARGET_PACKAGE; break;
        case 'error': resp = "Error: Something went wrong"; break;
    }
    devLog(`Preset [${type}]: ${resp}`, 'resp');
    mockResolver(resp);
    mockResolver = null;
}

// MOCK ADB IMPLEMENTATION
class MockADB {
    async connectAdb(path) {
        devLog(`connecting to ${path}...`);
        return this; // Return self as the 'adb' instance
    }

    async shell(cmd) {
        devLog(`$ ${cmd}`, 'cmd');
        devLog(`Waiting for response...`, 'waiting');
        
        // Return a Promise that the UI will resolve
        const responseText = await new Promise(resolve => {
            mockResolver = resolve;
        });

        // Convert string response to WebADB compatible stream
        const encoder = new TextEncoder();
        const view = encoder.encode(responseText + "\n");
        
        return {
            read: async function() {
                if (this.called) return { done: true, value: undefined };
                this.called = true;
                return { done: false, value: view };
            },
            called: false
        };
    }

    async sync() {
        devLog(`> Requesting SYNC service`, 'cmd');
        return {
            push: async (file, path, mode, onProgress) => {
                devLog(`> PUSH ${file.name} to ${path}`, 'cmd');
                // Simulate progress
                for(let i=0; i<=100; i+=20) {
                    await sleep(200);
                    onProgress(i, 100);
                    devLog(`Upload: ${i}%`, 'info');
                }
                devLog(`> PUSH Complete`, 'resp');
                return true;
            },
            quit: async () => devLog(`> SYNC Closed`, 'info')
        };
    }
}

window.enableDevMode = function() {
    window.DEV_MODE = true;
    initDevConsole();
    
    // Auto-enable update mock
    foundRelease = { url: "http://mock-url/file.apk" }; 
    const updateInfo = document.getElementById('update-info-text');
    if(updateInfo) updateInfo.innerHTML = `גרסה חדשה זמינה: <b>v1.0.0-MOCK</b>`;
    
    showToast("Developer Mode & Mock Device Enabled");
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- REAL LOGIC (Now cleaner because it relies on the injected object) ---

// --- IMPROVED ERROR MAPPING ---
const ADB_ERRORS = {
    "INSTALL_FAILED_ALREADY_EXISTS": "האפליקציה כבר מותקנת. מנסה לעדכן...",
    "INSTALL_FAILED_INSUFFICIENT_STORAGE": "אין מספיק מקום פנוי במכשיר.",
    "INSTALL_FAILED_UPDATE_INCOMPATIBLE": "קיימת גרסה קודמת עם חתימה שונה. יש למחוק אותה ידנית.",
    "Permission denied": "אין הרשאה לביצוע הפעולה. וודא שאישרת 'ניפוי באגים' במכשיר.",
    "device unauthorized": "המכשיר לא מאושר. בדוק את מסך המכשיר ואשר את החיבור.",
    "not found": "המכשיר התנתק. בדוק את תקינות הכבל.",
    "there are already some accounts": "שגיאה: נמצאו חשבונות פעילים. חזור לשלב 2.",
    "already a device owner": "שגיאה: כבר קיים מנהל מכשיר (Device Owner). יש לבצע איפוס יצרן.",
};


async function connectAdb() {
    try {
        if (window.DEV_MODE) {
            // In Dev Mode, we swap the real ADB library for our Mock Class
            webusb = new MockADB(); 
            adb = await webusb.connectAdb("mock::device");
        } else {
            webusb = await Adb.open("WebUSB");
            adb = await webusb.connectAdb("host::");
        }

        if(adb) {
            // Note: In dev mode, this shell command will pause waiting for the 'model' preset
            let shell = await adb.shell("getprop ro.product.model");
            let model = await readAll(shell);
            
            // Cleanup model string (remove prefix if present from getprop)
            model = model.replace('ro.product.model:', '').trim();
            if(!model) model = "Generic Android";

            updateStatusBadge('adb-status', `<span class="material-symbols-rounded">link</span> מחובר: ${model}`, 'success');
            
            document.getElementById('btn-connect').style.display = 'none';
            const nextBtn = document.getElementById('btn-next-adb');
            nextBtn.style.display = 'inline-flex';
            nextBtn.disabled = false;
            appState.adbConnected = true;
            
            showToast("המכשיר חובר בהצלחה");
        }
    } catch (e) {
        showToast("שגיאה בחיבור: " + e.message);
        console.error(e);
    }
}

async function checkAccounts() {
    const accountListDiv = document.getElementById('account-list');
    accountListDiv.innerHTML = ''; 

    if(!adb) { showToast("ADB לא מחובר"); return; }
    
    updateStatusBadge('account-status', `<span class="material-symbols-rounded">hourglass_top</span> בודק...`, '');
    
    try {
        // שימוש בפקודה קלה יותר מ-dumpsys
        let s = await adb.shell("cmd account list");
        let output = await readAll(s);
        
        // אם הפקודה cmd לא נתמכת (מכשירים ישנים מאוד), ננסה dumpsys כגיבוי
        if (!output && !window.DEV_MODE) {
            s = await adb.shell("dumpsys account");
            output = await readAll(s);
        }

        console.log("Accounts output:", output); // לבדיקה בקונסול

        // Regex שתופס פורמטים שונים של חשבונות
        const accountRegex = /Account\s*\{name=([^,]+),\s*type=([^}]+)\}/gi;
        let matches = [...output.matchAll(accountRegex)];

        if (matches.length === 0) {
            updateStatusBadge('account-status', `<span class="material-symbols-rounded">check_circle</span> מכשיר נקי`, 'success');
            document.getElementById('btn-next-acc').disabled = false;
            appState.accountsClean = true;
            showToast("המכשיר מוכן להתקנה");
        } else {
            updateStatusBadge('account-status', `<span class="material-symbols-rounded">error</span> נמצאו ${matches.length} חשבונות`, 'error');
            
            let listHtml = '<b>יש להסיר את החשבונות הבאים מהגדרות המכשיר:</b><ul style="margin-top:10px;">';
            matches.forEach(match => {
                const name = match[1];
                const type = match[2].split('.').pop(); // מציג רק את סוג החשבון (למשל google)
                listHtml += `<li><strong>${name}</strong> (${type})</li>`;
            });
            listHtml += '</ul>';
            
            accountListDiv.innerHTML = listHtml;
            document.getElementById('btn-next-acc').disabled = true;
            appState.accountsClean = false;
        }
    } catch (e) {
        showToast("שגיאה בבדיקת חשבונות");
        console.error("Account check error:", e);
    }
}

async function checkForUpdates() {
    const infoText = document.getElementById('update-info-text');
    const btn = document.getElementById('btn-download');
    
    // We keep this check simple as it talks to GitHub, not ADB
    if (window.DEV_MODE) {
        infoText.innerHTML = `גרסה חדשה זמינה: <b>v1.0.0-MOCK</b>`;
        btn.disabled = false;
        foundRelease = { url: "http://mock" };
        return;
    }

    try {
        const apiUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO_NAME}/releases/latest`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error("Could not fetch releases from GitHub");
        
        const data = await response.json();
        const asset = data.assets.find(a => a.name.endsWith('.apk'));
        
        if (!asset) throw new Error("No APK asset found in the latest release");

        foundRelease = asset;
        infoText.innerHTML = `גרסה חדשה זמינה: <b>${data.tag_name}</b>`;
        btn.disabled = false;

    } catch (error) {
        infoText.innerText = "לא נמצאו עדכונים (משתמש בגרסה מובנית).";
        console.error(error);
    }
}

async function startDownload() {
    if (!foundRelease) return;

    const btn = document.getElementById('btn-download');
    const bar = document.getElementById('dl-progress-bar');
    const wrapper = document.getElementById('dl-progress-wrapper');
    const text = document.getElementById('dl-status-text');

    btn.disabled = true;
    wrapper.style.display = 'block';
    text.innerText = "מוריד...";

    if (window.DEV_MODE) {
        for(let i=0; i<=100; i+=10) {
            bar.style.width = i + "%";
            text.innerText = i + "%";
            await sleep(100);
        }
        apkBlob = new Blob(["mock-data"]); 
        text.innerText = "הורדה הושלמה! (MOCK)";
        appState.apkDownloaded = true;
        setTimeout(() => navigateTo('page-install', 4), 1000);
        return;
    }

    try {
        const response = await fetch(foundRelease.url, {
            headers: { 'Accept': 'application/octet-stream' }
        });
        if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);

        const reader = response.body.getReader();
        const contentLength = +response.headers.get('Content-Length');
        let receivedLength = 0;
        let chunks = [];

        while(true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(value);
            receivedLength += value.length;
            
            if(contentLength) {
                let pct = Math.round((receivedLength / contentLength) * 100);
                bar.style.width = pct + "%";
                text.innerText = pct + "%";
            }
        }

        apkBlob = new Blob(chunks);
        text.innerText = "הורדה הושלמה!";
        appState.apkDownloaded = true;
        setTimeout(() => navigateTo('page-install', 4), 1000);

    } catch (e) {
        text.innerText = "שגיאה בהורדה";
        showToast(e.message);
        btn.disabled = false;
        console.error(e);
    }
}


/**
 * Helper to execute shell commands with validation and Hebrew feedback
 */
async function executeAdbCommand(command, description) {
    log(`> ${description}...`, 'info');
    try {
        const shell = await adb.shell(command);
        const response = await readAll(shell);
        
        // Android shell often returns error strings even if the command "executes"
        const lowerRes = response.toLowerCase();
        
        // Search for known errors in the response
        for (const [key, hebrewMsg] of Object.entries(ADB_ERRORS)) {
            if (response.includes(key)) {
                throw new Error(hebrewMsg + ` (${key})`);
            }
        }

        // Generic failure check (common in pm install)
        if (lowerRes.includes("failure") || lowerRes.includes("error")) {
             throw new Error("נכשלה הפעולה: " + response);
        }

        log(` הצלחה: ${description}`, 'success');
        return response;
    } catch (e) {
        log(` שגיאה ב${description}: ${e.message}`, 'error');
        throw e; // Rethrow to stop the installation sequence
    }
}

async function runInstallation() {
    const btn = document.getElementById('btn-install-start');
    const logEl = document.getElementById('install-log');
    logEl.innerHTML = ""; // Clear log
    
    if(!adb) { 
        showToast("ADB לא מחובר"); 
        return; 
    }

    btn.disabled = true;
    updateProgress(0);
    
    try {
        // 1. Validate APK
        if(!apkBlob) {
            log("> טוען קובץ התקנה...", 'info');
            const resp = await fetch('apk/update.apk');
            if(!resp.ok) throw new Error("קובץ ה-APK חסר בשרת.");
            apkBlob = await resp.blob();
        }

        // 2. Push File
        log("> מעביר קובץ למכשיר...", 'info');
        const sync = await adb.sync();
        const file = new File([apkBlob], "app.apk");
        
        await sync.push(file, "/data/local/tmp/app.apk", 0o644, (sent, total) => {
            updateProgress(0.1 + (sent / total * 0.3));
        });
        await sync.quit();
        log(" הקובץ הועבר בהצלחה.", 'success');

        // 3. Install
        updateProgress(0.5);
        await executeAdbCommand(
            `pm install -r "/data/local/tmp/app.apk"`, 
            "התקנת אפליקציה"
        );

        // 4. Set Device Owner
        updateProgress(0.7);
        await executeAdbCommand(
            `dpm set-device-owner ${TARGET_PACKAGE}/${DEVICE_ADMIN}`, 
            "הגדרת מנהל מערכת"
        );

        // 5. Launch
        updateProgress(0.9);
        await executeAdbCommand(
            `am start -n ${TARGET_PACKAGE}/.MainActivity`, 
            "פתיחת אפליקציה"
        );

        updateProgress(1.0);
        log("\n הכלי הותקן והוגדר בהצלחה!", 'success');
        showToast("הסתיים בהצלחה!");

    } catch (e) {
        console.error(e);
        log(`\n התקנה נעצרה: ${e.message}`, 'error');
        showToast("ההתקנה נכשלה");
        btn.disabled = false;
    }
}

async function readAll(stream) {
    const decoder = new TextDecoder();
    let res = "";
    try {
        while (true) {
            // ב-WebADB משתמשים ב-receive() כדי לקבל הודעה מהמכשיר
            let msg = await stream.receive();

            if (msg.cmd === "WRTE") {
                // הודעת WRTE מכילה נתונים
                res += decoder.decode(msg.data);
                // חובה לשלוח OKAY חזרה כדי שהמכשיר ימשיך לשלוח את שאר הנתונים
                await stream.send("OKAY");
            } else if (msg.cmd === "CLSE") {
                // הודעת CLSE אומרת שהמכשיר סיים להעביר נתונים
                break;
            }
        }
    } catch (e) {
        console.warn("Stream reading interrupted", e);
    }
    return res.trim();
}
```
