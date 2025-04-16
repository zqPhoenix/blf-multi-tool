const fs = require('fs');
let $ = require('jquery');
window.$ = $;
require("dotenv").config();
const path = require('path');
const WebSocket = require("ws");
const { ipcRenderer } = require('electron');

const crypto = require('crypto');
const fetch = require("node-fetch");

const windowControls = {
    minimize: () => {
        ipcRenderer.send('minimize-window');
    },
    maximize: () => {
        ipcRenderer.send('maximize-window');
    },
    close: () => {
        ipcRenderer.send('close-window');
    }
};

class ChatV2 {
    constructor(username, password) {
        this.username = username;
        this.password = ChatV2.hashSHA512(password);
        this.server = "wss://game-ca-1.blayzegames.com";
    }

    /**
     * Hashes a string using SHA-512 algorithm.
     * @param {string} input - The input string to hash.
     * @returns {string} The SHA-512 hash of the input string.
     */
    static hashSHA512(input) {
        return crypto.createHash('sha512').update(input, 'utf8').digest('hex');
    }

    async send(chatMsg) {
        const body = new URLSearchParams({
            platform: "WebGLPlayer",
            username: this.username,
            password: this.password,
            chat: chatMsg
        });

        try {
            const response = await fetch("https://server.blayzegames.com/OnlineAccountSystem/send_lobby_chatV2.php", {
                method: "POST",
                headers: {
                    "accept": "*/*",
                    "content-type": "application/x-www-form-urlencoded",
                    "referer": "https://bullet-force-multiplayer.game-files.crazygames.com/",
                },
                body
            });

            const text = await response.text();
            console.log("Chat sent response:", text);
        } catch (error) {
            console.error("Error sending chat:", error);
        }
    }

    async get() {
        const body = new URLSearchParams({
            platform: "WebGLPlayer",
            username: this.username,
            password: this.password,
            server: this.server
        });

        try {
            const response = await fetch("https://server.blayzegames.com/OnlineAccountSystem/get_lobby_chatV2.php", {
                method: "POST",
                headers: {
                    "accept": "*/*",
                    "content-type": "application/x-www-form-urlencoded",
                    "referer": "https://bullet-force-multiplayer.game-files.crazygames.com/",
                },
                body
            });

            if (response.status !== 200) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            let text = await response.text();
            let json = text.split("<b>Notice</b>:  Undefined index: username in <b>/home/bf/html/OnlineAccountSystem/get_lobby_chatV2.php</b> on line <b>15</b><br />")[1];
            return JSON.parse(json);
        } catch (error) {
            console.error("Error fetching chat:", error);
        }
    }
}

class PacketScanner {
    constructor() {
      this.packetTypeMap = {
        4: 'SendAnnouncement',
        // Add more type mappings here if needed
      };
    }
  
    detectPacketType(packet) {
      const type = packet?.type;
      if (this.packetTypeMap[type]) {
        return this.packetTypeMap[type];
      }
  
      const viewIds = this.findViewIds(packet);
      if (viewIds.length > 0) {
        return `PacketWithViewIDs(${viewIds.join(', ')})`;
      }
  
      return 'UnknownPacket';
    }
  
    findViewIds(data, found = new Set()) {
      if (Array.isArray(data)) {
        for (const item of data) {
          this.findViewIds(item, found);
        }
      } else if (data && typeof data === 'object') {
        for (const key in data) {
          this.findViewIds(data[key], found);
        }
      } else if (typeof data === 'number') {
        if (this._isViewId(data)) {
          found.add(data);
        }
      }
  
      return [...found];
    }
  
    _isViewId(number) {
      return number % 1000 === 1;
    }
}  

class PhotonParser {
    constructor(buffer) {
        this.view = new DataView(buffer);
        this.offset = 0;
    }

    /* Helpers */

    increment(inc) {
        // increment offset without leaving the bounds
        this.offset = Math.min(this.offset + inc, this.view.byteLength - 1);
    }

    // returns Uint8Array with padding bytes
    readFixedBytes(len) {
        if (len === 0) { return new Uint8Array([]); }

        this.increment(len);
        return new Uint8Array(this.view.buffer.slice(this.offset - len, this.offset));
    }

    #extendMap(map) {
        map.rawGet = map.get;
        map.rawSet = map.set;

        // workaround for object equality not working in JS
        map.get = function (key) {
            return map.rawGet(map.keys().find(x => x.type === key.type && x.data === key.data));
        }
        map.set = function (key, value) {
            return map.rawSet(map.keys().find(x => x.type === key.type && x.data === key.data), value);
        }
        map.byIndex = function (idx) {
            let i = 0;
            for (const value of map.values()) {
                if (i === idx) return value;
            }
            return undefined;
        }
    }

    /* Primitives */

    readUint8() {
        let value = this.view.getUint8(this.offset);
        this.increment(1);

        return value;
    }

    readUint16() {
        let value = this.view.getUint16(this.offset, false);
        this.increment(2);

        return value;
    }

    readUint32() {
        let value = this.view.getUint32(this.offset, false);
        this.increment(4);

        return value;
    }

    readUint64() {
        let value = this.view.getBigUint64(this.offset, false);
        this.increment(8);

        return value;
    }

    readFloat() {
        let value = this.view.getFloat32(this.offset, false);
        this.increment(4);

        return value;
    }

    readDouble() {
        let value = this.view.getFloat64(this.offset, false);
        this.increment(8);

        return value;
    }

    /* Photon Types */

    // 0x44 (Dictionary)
    parseDictionary() {
        let keyType = this.readUint8();
        let valType = this.readUint8();
        let len = this.readUint16();

        let readKey = keyType === 0 || keyType === 0x2A;
        let readVal = valType === 0 || valType === 0x2A;

        let map = new Map();

        for (let i = 0; i < len; i++) {
            let key = this.parsePhotonType(readKey ? null : keyType);
            let val = this.parsePhotonType(readVal ? null : valType);

            if (key.data != null) {
                map.set(key, val);
            }
        }

        // adds Photon helpers to the map
        this.#extendMap(map)

        return {keyType, valType, map};
    }

    // 0x61 (StringArray)
    parseStringArray() {
        let len = this.readUint16();
        let strings = [];

        for (let i = 0; i < len; i++) {
            strings.push(this.parseString());
        }

        return strings;
    }

    // 0x62 (Byte)
    parseByte() {
        return this.readUint8();
    }

    // 0x63 (CustomData)
    parseCustomData() {
        const variant = String.fromCharCode(this.readUint8());
        const len = this.readUint16();
        let data;

        switch (variant) {
            case 'W': data = this.parseVec2(); break;
            case 'V': data = this.parseVec3(); break;
            case 'Q': data = this.parseQuat(); break;
            case 'P': data = this.parsePhotonPlayer(); break;
            default: data = this.parseUnknownCustom(len);
        }

        return { variant, data };
    }

    // 0x63 (CustomData), "W" (Vec2)
    parseVec2() {
        return {
            x: this.readFloat(),
            y: this.readFloat(),
        };
    }

    // 0x63 (CustomData), "V" (Vec3)
    parseVec3() {
        return {
            x: this.readFloat(),
            y: this.readFloat(),
            z: this.readFloat(),
        };
    }

    // 0x63 (CustomData), "Q" (Quat)
    parseQuat() {
        return {
            w: this.readFloat(),
            x: this.readFloat(),
            y: this.readFloat(),
            z: this.readFloat(),
        };
    }

    // 0x63 (CustomData), "P" (PhotonPlayer)
    parsePhotonPlayer() {
        return {
            player_id: this.readUint32(),
        }
    }

    // 0x63 (CustomData), unknown
    parseUnknownCustom(len) {
        return {
            data: this.readFixedBytes(len),
        }
    }

    // 0x64 (Double)
    parseDouble() {
        return this.readDouble();
    }

    // 0x65 (EventData)

    // 0x66 (Float)
    parseFloat() {
        return this.readFloat();
    }

    // 0x68 (HashTable)
    parseHashTable() {
        let len = this.readUint16();

        let map = new Map();

        for (let i = 0; i < len; i++) {
            let key = this.parsePhotonType();
            let val = this.parsePhotonType();

            if (key.data != null) {
                map.set(key, val);
            }
        }

        // adds Photon helpers to the map
        this.#extendMap(map)

        return map;
    }

    // 0x69 (Integer)
    parseInteger() {
        return this.readUint32();
    }

    // 0x6B (Short)
    parseShort() {
        return this.readUint16();
    }

    // 0x6C (Long)
    parseLong() {
        return this.readUint64();
    }
    // 0x6F (Boolean)
    parseBool() {
        return !!this.readUint8();
    }

    // 0x70 (OpResponse)

    // 0x71 (OpRequest)

    // 0x73 (String)
    parseString() {
        let len = this.readUint16();
        let decoder = new TextDecoder();

        return decoder.decode(this.readFixedBytes(len));
    }

    // 0x78 (ByteArray)
    parseByteArray() {
        let len = this.readUint32();
        return this.readFixedBytes(len);
    }

    // 0x79 (Array)
    parseArray() {
        let len = this.readUint16();
        let type = this.readUint8();
        let arr = [];

        for (let i = 0; i < len; i++) {
            arr.push(this.parsePhotonType(type));
        }

        return {type, arr};
    }

    // 0x7A (ObjectArray)
    parseObjectArray() {
        let len = this.readUint16();
        let arr = [];

        for (let i = 0; i < len; i++) {
            arr.push(this.parsePhotonType());
        }

        return arr;
    }

    /* Logic */

    parsePhotonType(fixedType = null) {
        let type = fixedType ?? this.readUint8();
        var data = null;
        switch (type) {
            case 0x00:  // Null type (additional)
                data = null; break;
            case 0x2A:  // Null type (original)
                data = null; break;
            case 0x44:  // Dictionary
                data = this.parseDictionary(); break;
            case 0x61:  // StringArray
                data = this.parseStringArray(); break;
            case 0x62:  // Byte
                data = this.parseByte(); break;
            case 0x63:  // CustomData
                data = this.parseCustomData(); break;
            case 0x64:  // Double
                data = this.parseDouble(); break;
            case 0x66:  // Float
                data = this.parseFloat(); break;
            case 0x68:  // HashTable
                data = this.parseHashTable(); break;
            case 0x69:  // Integer
                data = this.parseInteger(); break;
            case 0x6B:  // Short
                data = this.parseShort(); break;
            case 0x6C:  // Long
                data = this.parseLong(); break;
            case 0x6E:  // IntArray
                data = this.parseIntArray(); break;
            case 0x6F:  // Boolean
                data = this.parseBool(); break;
            case 0x70:  // OpResponse
                data = this.parseOpResponse(); break;
            case 0x71:  // OpRequest
                data = this.parseOpRequest(); break;
            case 0x73:  // String
                data = this.parseString(); break;
            case 0x78:  // ByteArray
                data = this.parseByteArray(); break;
            case 0x79:  // Array
                data = this.parseArray(); break;
            case 0x7A:  // ObjectArray
                data = this.parseObjectArray(); break;
            // Add ASCII character codes that appeared in the error logs
            case 45:  // "-" character
            case 80:  // "P" character
            case 101: // "e" character
            case 112: // "p" character
            case 116: // "t" character
            case 119: // "w" character
            // Add the other error codes from the logs
            case 249: // 0xF9
            case 254: // 0xFE
            case 255: // 0xFF
                // For these unexpected types, try to safely skip some bytes
                console.warn(`Encountered likely text data or invalid type: ${type} (0x${type.toString(16)}) at offset ${this.offset}`);
                // Try to recover by reading a byte and continuing
                this.readUint8();
                data = null;
                break;
            default:
                console.warn("Photon Parser: Unknown type '%d' (0x%s) at offset '%d'", 
                    type, type.toString(16).padStart(2, '0'), this.offset);
                // Try to recover by skipping this byte
                data = null;
        }
    
        return { type, data };
    }
    
    // Add missing method implementations for OpResponse and OpRequest
    parseOpResponse() {
        // Basic implementation - you may need to adjust based on your protocol
        console.log("Parsing OpResponse at offset", this.offset);
        try {
            const operationCode = this.readUint8();
            const returnCode = this.readUint16();
            const parameters = this.parseHashTable();
            return { operationCode, returnCode, parameters };
        } catch (e) {
            console.error("Error parsing OpResponse:", e);
            // Return minimal data to avoid crashing
            return { operationCode: 0, returnCode: 0, parameters: new Map() };
        }
    }
    
    parseOpRequest() {
        // Basic implementation - you may need to adjust based on your protocol
        console.log("Parsing OpRequest at offset", this.offset);
        try {
            const operationCode = this.readUint8();
            const parameters = this.parseHashTable();
            return { operationCode, parameters };
        } catch (e) {
            console.error("Error parsing OpRequest:", e);
            // Return minimal data to avoid crashing
            return { operationCode: 0, parameters: new Map() };
        }
    }
    
    // Enhance parseIntArray with better safety checks
    // 0x6E (IntArray)
    parseIntArray() {
        if (this.offset + 4 > this.view.byteLength) {
            console.error("Not enough bytes to read int array length at offset", this.offset);
            return []; // Return empty array instead of crashing
        }
        
        let len = this.readUint32();
        console.log(`Reading int array of length ${len} at offset ${this.offset}`);
        
        // Much stricter safety check
        const MAX_REASONABLE_ARRAY_LENGTH = 10000; // Adjust as needed
        if (len > MAX_REASONABLE_ARRAY_LENGTH || len < 0 || this.offset + (len * 4) > this.view.byteLength) {
            console.error(`Int array length ${len} is invalid or would read beyond buffer end`);
            
            // Try to recover by returning an empty array and advancing just past the length field
            // Don't try to read all those integers
            return [];
        }
        
        // Only proceed if the length seems reasonable
        let ints = [];
        try {
            for (let i = 0; i < len; i++) {
                if (this.offset + 4 > this.view.byteLength) {
                    console.error(`Buffer underrun while reading int array at index ${i}`);
                    break;
                }
                ints.push(this.readUint32());
            }
        } catch (e) {
            console.error("Error reading int array:", e);
        }
        
        return ints;
    }
    
    // Add a method to help with debugging
    dumpBufferHex(startOffset, length = 32) {
        const start = Math.max(0, startOffset);
        const end = Math.min(this.view.byteLength, start + length);
        const bytes = new Uint8Array(this.view.buffer.slice(start, end));
        
        let hexDump = "Buffer dump: ";
        let asciiDump = "ASCII: ";
        
        for (let i = 0; i < bytes.length; i++) {
            const byte = bytes[i];
            hexDump += byte.toString(16).padStart(2, '0') + " ";
            
            // Add printable ASCII characters to the ASCII dump
            if (byte >= 32 && byte <= 126) {
                asciiDump += String.fromCharCode(byte);
            } else {
                asciiDump += ".";
            }
        }
        
        console.log(hexDump);
        console.log(asciiDump);
    }
}

class PhotonSerializer {
    constructor(packet) {
        this.packet = packet;
        this.buffer = [];
    }

    /* Helpers */

    pushBytes(bytes) {
        this.buffer.push(...bytes);
    }

    /* Primitives */
    // this code uses lots of performance hacks

    #primView = new DataView(new ArrayBuffer(8));

    writeUint8(value) {
        this.pushBytes([value])
    }

    writeUint16(value) {
        this.#primView.setUint16(0, value, false);
        this.pushBytes(new Uint8Array(this.#primView.buffer.slice(0, 2)));
    }

    writeUint32(value) {
        this.#primView.setUint32(0, value, false);
        this.pushBytes(new Uint8Array(this.#primView.buffer.slice(0, 4)));
    }

    writeUint64(value) {
        this.#primView.setBigUint64(0, value, false);
        this.pushBytes(new Uint8Array(this.#primView.buffer.slice(0, 8)));
    }

    writeFloat(value) {
        this.#primView.setFloat32(0, value, false);
        this.pushBytes(new Uint8Array(this.#primView.buffer.slice(0, 4)));
    }

    writeDouble(value) {
        this.#primView.setFloat64(0, value, false);
        this.pushBytes(new Uint8Array(this.#primView.buffer.slice(0, 8)));
    }

    /* Photon Types */

    // 0x44 (Dictionary)
    serializeDictionary(value) {
        this.writeUint8(value.keyType);
        this.writeUint8(value.valType);
        this.writeUint16(value.map.size);

        let writeKey = value.keyType === 0 || value.keyType === 0x2A;
        let writeVal = value.valType === 0 || value.valType === 0x2A;

        for (const [key, val] of value.map.entries()) {
            this.serializePhotonType(key, writeKey);
            this.serializePhotonType(val, writeVal);
        }
    }

    // 0x61 (StringArray)
    serializeStringArray(value) {
        this.writeUint16(value.length);
        for (const str of value) {
            this.serializeString(str);
        }
    }

    // 0x62 (Byte)
    serializeByte(value) {
        this.writeUint8(value);
    }

    // 0x63 (CustomData)
    serializeCustomData(value) {
        this.writeUint8(value.variant.charCodeAt(0));
        switch (value.variant) {
            case 'W': return this.serializeVec2(value.data);
            case 'V': return this.serializeVec3(value.data);
            case 'Q': return this.serializeQuat(value.data);
            case 'P': return this.serializePhotonPlayer(value.data);
            default: return this.serializeUnknownCustom(value.data);
        }
    }

    // 0x63 (CustomData), "W" (Vec2)
    serializeVec2(value) {
        this.writeUint16(8);
        this.writeFloat(value.x);
        this.writeFloat(value.y);
    }

    // 0x63 (CustomData), "V" (Vec3)
    serializeVec3(value) {
        this.writeUint16(12);
        this.writeFloat(value.x);
        this.writeFloat(value.y);
        this.writeFloat(value.z);
    }

    // 0x63 (CustomData), "Q" (Quat)
    serializeQuat(value) {
        this.writeUint16(16);
        this.writeFloat(value.w);
        this.writeFloat(value.x);
        this.writeFloat(value.y);
        this.writeFloat(value.z);
    }

    // 0x63 (CustomData), "P" (PhotonPlayer)
    serializePhotonPlayer(value) {
        this.writeUint16(4);
        this.writeUint32(value.player_id);
    }

    // 0x63 (CustomData), unknown
    serializeUnknownCustom(value) {
        this.writeUint16(value.data.length);
        this.pushBytes(...value.data);
    }

    // 0x64 (Double)
    serializeDouble(value) {
        this.writeDouble(value);
    }

    // 0x65 (EventData)

    // 0x66 (Float)
    serializeFloat(value) {
        this.writeFloat(value);
    }

    // 0x68 (HashTable)
    serializeHashTable(value) {
        this.writeUint16(value.size);

        for (const [key, val] of value.entries()) {
            this.serializePhotonType(key);
            this.serializePhotonType(val);
        }
    }

    // 0x69 (Integer)
    serializeInteger(value) {
        this.writeUint32(value);
    }

    // 0x6B (Short)
    serializeShort(value) {
        this.writeUint16(value);
    }

    // 0x6C (Long)
    serializeLong(value) {
        this.writeUint64(value);
    }

    // 0x6E (IntArray)
    serializeIntArray(value) {
        this.writeUint32(value.length);

        for (const entry of value) {
            this.writeUint32(entry);
        }
    }

    // 0x6F (Boolean)
    serializeBool(value) {
        this.writeUint8(value ? 1 : 0);
    }

    // 0x70 (OpResponse)

    // 0x71 (OpRequest)

    // 0x73 (String)
    serializeString(value) {
        let encoder = new TextEncoder();
        let bytes = encoder.encode(value);

        this.writeUint16(bytes.length);
        this.pushBytes(bytes);
    }

    // 0x78 (ByteArray)
    serializeByteArray(value) {
        this.writeUint32(value.length);
        this.pushBytes(value);
    }

    // 0x79 (Array)
    serializeArray(value) {
        this.writeUint16(value.arr.length);
        this.writeUint8(value.type);

        for (const entry of value.arr) {
            this.serializePhotonType(entry, false);
        }
    }

    // 0x7A (ObjectArray)
    serializeObjectArray(value) {
        this.writeUint16(value.length);

        for (const entry of value) {
            this.serializePhotonType(entry);
        }
    }

    /* Logic */

    serializePhotonType(object, writeType = true) {
        if (writeType) this.writeUint8(object.type);

        switch (object.type) {
            case 0x2A:
                break;
            case 0x44:
                this.serializeDictionary(object.data); break;
            case 0x61:
                this.serializeStringArray(object.data); break;
            case 0x62:
                this.serializeByte(object.data); break;
            case 0x63:
                this.serializeCustomData(object.data); break;
            case 0x64:
                this.serializeDouble(object.data); break;
            case 0x66:
                this.serializeFloat(object.data); break;
            case 0x68:
                this.serializeHashTable(object.data); break;
            case 0x69:
                this.serializeInteger(object.data); break;
            case 0x6B:
                this.serializeShort(object.data); break;
            case 0x6C:
                this.serializeLong(object.data); break;
            case 0x6E:
                this.serializeIntArray(object.data); break;
            case 0x6F:
                this.serializeBool(object.data); break;
            case 0x73:
                this.serializeString(object.data); break;
            case 0x78:
                this.serializeByteArray(object.data); break;
            case 0x79:
                this.serializeArray(object.data); break;
            case 0x7A:
                this.serializeObjectArray(object.data); break;
        }
    }

    serialize() {
        this.writeUint8(this.packet.magic);

        switch (this.packet.magic) {
            case 0xF3: {
                this.writeUint8(this.packet.type);

                switch (this.packet.type) {
                    case 2:
                        this.writeUint8(this.packet.op_code);
                        if(this.packet.type === 2) break; // fall-through if 3
                    case 3:
                        this.writeUint16(this.packet.return_code);
                        this.serializePhotonType(this.packet.debug_message);
                        break;
                    case 4:
                        this.writeUint8(this.packet.event_id);
                        break;
                }

                this.writeUint16(Object.keys(this.packet.sections).length)

                for (const section of this.packet.sections) {
                    this.writeUint8(section[0]);
                    this.serializePhotonType(section[1]);
                }

                break;
            }
            case 0xF0:
                this.writeUint32(this.packet.server_time);
                this.writeUint32(this.packet.client_time);
                break;
            default:
                throw "I don't know how to serialize this";
        }

        return new Uint8Array(this.buffer).buffer;
    }
}

class PhotonPacket {
    constructor(buffer) {
        try {
            this.parser = new PhotonParser(buffer);
            console.log("Parser created with buffer length:", buffer.byteLength);
            
            try {
                this.magic = this.parser.readUint8();
                console.log("Magic byte read:", this.magic.toString(16));
                
                switch (this.magic) {
                    case 0xF3:
                        try {
                            this.type = this.parser.readUint8();
                            console.log("Packet type:", this.type);
                            this.encrypted = this.type & 0x80 > 0;
                            this.type &= 0x7F;
                            
                            switch (this.type) {
                                case 2:
                                case 3:
                                case 4:
                                case 6:
                                case 7:
                                    this.relay = false;
                                    try {
                                        this.#parsePacketInfo(this.type);
                                    } catch (e) {
                                        console.error("Error parsing packet info:", e, "at offset", this.parser.offset);
                                        throw e;
                                    }
                                    break;
                                default:
                                    console.log("Unknown packet type:", this.type);
                                    this.relay = true;
                                    break;
                            }
                        } catch (e) {
                            console.error("Error processing F3 packet:", e, "at offset", this.parser.offset);
                            throw e;
                        }
                        break;
                        
                    case 0xF0:
                        try {
                            this.server_time = this.parser.readUint32();
                            this.client_time = this.parser.readUint32();
                            console.log("Read ping packet - server time:", this.server_time, "client time:", this.client_time);
                        } catch (e) {
                            console.error("Error processing F0 packet:", e, "at offset", this.parser.offset);
                            throw e;
                        }
                        break;
                        
                    default:
                        console.error("Unknown magic byte:", this.magic.toString(16));
                        throw new Error(`Buffer does not contain a recognized Photon packet (magic: 0x${this.magic.toString(16)})`);
                }
            } catch (e) {
                console.error("Error reading packet header:", e, "at offset", this.parser.offset);
                throw e;
            }
            
            if(this.parser.offset !== this.parser.view.byteLength - 1 && !this.relay) {
                console.warn("Photon packet was not read to end...", 
                    "Current offset:", this.parser.offset, 
                    "Buffer length:", this.parser.view.byteLength);
            }
        } catch (e) {
            console.error("Fatal error processing packet:", e);
            // Log the first few bytes of the buffer
            const preview = new Uint8Array(buffer.slice(0, Math.min(32, buffer.byteLength)));
            console.error("Buffer preview:", Array.from(preview).map(b => b.toString(16).padStart(2, '0')).join(' '));
            throw e;
        }
    }

    static fromBase64(str) {
        return new PhotonPacket(Uint8Array.from(atob(str).split("").map(x => x.charCodeAt(0))).buffer);
    }

    #parsePacketInfo(type) {
        switch (type) {
            case 2:
            case 6:
                this.op_code = this.parser.readUint8();
                if(type === 2 || type === 6) break; // fall-through if 3
            case 3:
            case 7:
                this.return_code = this.parser.readUint16();
                this.debug_message = this.parser.parsePhotonType();
                break;
            case 4:
                this.event_id = this.parser.readUint8();
                break;
        }
        this.sections = this.#parseSections();
    }

    #parseSections() {
        let len = this.parser.readUint16();
        let sections = [];
        for (let i = 0; i < len; i++) {
            sections.push([this.parser.readUint8(), this.parser.parsePhotonType()]);
        }

        return sections;
    }

    serialize() {
        if(this.relay) {
            console.warn("Tried to serialize a packet we don't support, ignored");
            return this.parser.view.buffer;
        }

        let serializer = new PhotonSerializer(this);
        return serializer.serialize();
    }

    verify() {
        let input_b64 = btoa(String.fromCharCode(...new Uint8Array(this.parser.view.buffer)));
        let serialized_b64 = btoa(String.fromCharCode(...new Uint8Array(this.serialize())));

        return input_b64 === serialized_b64;
    }
}

class PhotonPacketBuilder {
    /**
     * Creates a new request packet (type 2)
     * @param {number} opCode - The operation code for the request
     * @returns {Object} A new Photon packet object
     */
    static createRequest(opCode) {
        return {
            magic: 0xF3,
            type: 2,
            op_code: opCode,
            encrypted: false,
            relay: false,
            sections: [],
            
            // Helper method to add a parameter to the packet
            addParam(key, typeObj) {
                this.sections.push([key, typeObj]);
                return this;
            },
            
            // Serializes the packet to an ArrayBuffer
            toBuffer() {
                const serializer = new PhotonSerializer(this);
                return serializer.serialize();
            },
            
            // Converts the packet to a base64 string
            toBase64() {
                const buffer = this.toBuffer();
                return btoa(String.fromCharCode(...new Uint8Array(buffer)));
            }
        };
    }
    
    /**
     * Creates a new event packet (type 4)
     * @param {number} eventId - The event ID
     * @returns {Object} A new Photon packet object
     */
    static createEvent(eventId) {
        return {
            magic: 0xF3,
            type: 4,
            event_id: eventId,
            encrypted: false,
            relay: false,
            sections: [],
            
            // Helper method to add a parameter to the packet
            addParam(key, typeObj) {
                this.sections.push([key, typeObj]);
                return this;
            },
            
            // Serializes the packet to an ArrayBuffer
            toBuffer() {
                const serializer = new PhotonSerializer(this);
                return serializer.serialize();
            },
            
            // Converts the packet to a base64 string
            toBase64() {
                const buffer = this.toBuffer();
                return btoa(String.fromCharCode(...new Uint8Array(buffer)));
            }
        };
    }
    
    /**
     * Creates a new response packet (type 3)
     * @param {number} returnCode - The return code for the response
     * @param {string} debugMessage - Debug message (optional)
     * @returns {Object} A new Photon packet object
     */
    static createResponse(returnCode, debugMessage = "") {
        return {
            magic: 0xF3,
            type: 3,
            return_code: returnCode,
            debug_message: { type: 0x73, data: debugMessage },
            encrypted: false,
            relay: false,
            sections: [],
            
            // Helper method to add a parameter to the packet
            addParam(key, typeObj) {
                this.sections.push([key, typeObj]);
                return this;
            },
            
            // Serializes the packet to an ArrayBuffer
            toBuffer() {
                const serializer = new PhotonSerializer(this);
                return serializer.serialize();
            },
            
            // Converts the packet to a base64 string
            toBase64() {
                const buffer = this.toBuffer();
                return btoa(String.fromCharCode(...new Uint8Array(buffer)));
            }
        };
    }
    
    /**
     * Creates a new ping packet (magic 0xF0)
     * @param {number} serverTime - Server time
     * @param {number} clientTime - Client time
     * @returns {Object} A new Photon packet object
     */
    static createPing(serverTime, clientTime) {
        return {
            magic: 0xF0,
            server_time: serverTime,
            client_time: clientTime,
            
            // Serializes the packet to an ArrayBuffer
            toBuffer() {
                const serializer = new PhotonSerializer(this);
                return serializer.serialize();
            },
            
            // Converts the packet to a base64 string
            toBase64() {
                const buffer = this.toBuffer();
                return btoa(String.fromCharCode(...new Uint8Array(buffer)));
            }
        };
    }
    
    /**
     * Helper to create common Photon type objects
     */
    static types = {
        // Null value
        null() {
            return { type: 0x2A, data: null };
        },
        
        // String value
        string(value) {
            return { type: 0x73, data: value };
        },
        
        // Boolean value
        boolean(value) {
            return { type: 0x6F, data: !!value };
        },
        
        // Integer value
        integer(value) {
            return { type: 0x69, data: value };
        },
        
        // Short value
        short(value) {
            return { type: 0x6B, data: value };
        },
        
        // Byte value
        byte(value) {
            return { type: 0x62, data: value };
        },
        
        // Float value
        float(value) {
            return { type: 0x66, data: value };
        },
        
        // Double value
        double(value) {
            return { type: 0x64, data: value };
        },
        
        // Long value (BigInt)
        long(value) {
            return { type: 0x6C, data: BigInt(value) };
        },
        
        // ByteArray value
        byteArray(value) {
            return { type: 0x78, data: value };
        },
        
        // IntArray value
        intArray(value) {
            return { type: 0x6E, data: value };
        },
        
        // StringArray value
        stringArray(value) {
            return { type: 0x61, data: value };
        },
        
        // ObjectArray value
        objectArray(value) {
            return { type: 0x7A, data: value };
        },
        
        // Dictionary value
        dictionary(keyType, valType, entries = []) {
            const map = new Map();
            for (const [key, val] of entries) {
                map.set(key, val);
            }
            
            // Add helper methods
            const extendMap = (map) => {
                map.rawGet = map.get;
                map.rawSet = map.set;
                
                map.get = function (key) {
                    return map.rawGet(Array.from(map.keys()).find(x => x.type === key.type && x.data === key.data));
                };
                
                map.set = function (key, value) {
                    return map.rawSet(Array.from(map.keys()).find(x => x.type === key.type && x.data === key.data), value);
                };
                
                map.byIndex = function (idx) {
                    let i = 0;
                    for (const value of map.values()) {
                        if (i === idx) return value;
                        i++;
                    }
                    return undefined;
                };
            };
            
            extendMap(map);
            
            return { 
                type: 0x44, 
                data: { 
                    keyType, 
                    valType, 
                    map 
                } 
            };
        },
        
        // HashTable value
        hashTable(entries = []) {
            const map = new Map();
            for (const [key, val] of entries) {
                map.set(key, val);
            }
            
            // Add helper methods
            const extendMap = (map) => {
                map.rawGet = map.get;
                map.rawSet = map.set;
                
                map.get = function (key) {
                    return map.rawGet(Array.from(map.keys()).find(x => x.type === key.type && x.data === key.data));
                };
                
                map.set = function (key, value) {
                    return map.rawSet(Array.from(map.keys()).find(x => x.type === key.type && x.data === key.data), value);
                };
                
                map.byIndex = function (idx) {
                    let i = 0;
                    for (const value of map.values()) {
                        if (i === idx) return value;
                        i++;
                    }
                    return undefined;
                };
            };
            
            extendMap(map);
            
            return { type: 0x68, data: map };
        },
        
        // Vector2 custom type
        vector2(x, y) {
            return { 
                type: 0x63, 
                data: { 
                    variant: 'W', 
                    data: { x, y } 
                } 
            };
        },
        
        // Vector3 custom type
        vector3(x, y, z) {
            return { 
                type: 0x63, 
                data: { 
                    variant: 'V', 
                    data: { x, y, z } 
                } 
            };
        },
        
        // Quaternion custom type
        quaternion(w, x, y, z) {
            return { 
                type: 0x63, 
                data: { 
                    variant: 'Q', 
                    data: { w, x, y, z } 
                } 
            };
        },
        
        // PhotonPlayer custom type
        player(playerId) {
            return { 
                type: 0x63, 
                data: { 
                    variant: 'P', 
                    data: { player_id: playerId } 
                } 
            };
        },
        
        // Array type
        array(elementType, elements) {
            return { 
                type: 0x79, 
                data: { 
                    type: elementType, 
                    arr: elements 
                } 
            };
        }
    };
}

class Account {
    constructor(username, password, proxies) {
        this.username = username;
        this.password = Account.hashSHA512(password);
        this.passwordNonHashed = password;
    }

    /**
     * Hashes a string using SHA-512 algorithm.
     * @param {string} input - The input string to hash.
     * @returns {string} The SHA-512 hash of the input string.
     */
    static hashSHA512(input) {
        return crypto.createHash('sha512').update(input, 'utf8').digest('hex');
    }

    /**
     * Registers account on Bullet Force's server.
     * @returns {Promise<object>} An object containing the registration status.
     */
    async generateAccount() {
        const response = await fetch("https://server.blayzegames.com/OnlineAccountSystem//register.php?&requiredForMobile=192447214", {
            method: "POST",
            headers: {
                "accept": "*/*",
                "accept-language": "en-US,en;q=0.9",
                "content-type": "application/x-www-form-urlencoded",
                "priority": "u=1, i",
                "sec-ch-ua": "\"Not)A;Brand\";v=\"99\", \"Opera GX\";v=\"113\", \"Chromium\";v=\"127\"",
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": "\"Windows\"",
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "cross-site",
                "Referer": "https://games.crazygames.com/",
                "Referrer-Policy": "strict-origin-when-cross-origin"
            },
            body: `newAccountInfo=id%24%23%40(_field_name_value_separator_*%26%25%5e%24%23%40(_fields_separator_*%26%25%5eusername%24%23%40(_field_name_value_separator_*%26%25%5e${encodeURIComponent(this.username)}%24%23%40(_fields_separator_*%26%25%5epassword%24%23%40(_field_name_value_separator_*%26%25%5e${this.password}%24%23%40(_fields_separator_*%26%25%5eemail%24%23%40(_field_name_value_separator_*%26%25%5e${encodeURIComponent(this.username)}_%40unregistered.com%24%23%40(_fields_separator_*%26%25%5ecustominfo%24%23%40(_field_name_value_separator_*%26%25%5e%3c%3fxml%20version%3d%221.0%22%20encoding%3d%22utf-16%22%3f%3e%0a%3cAS_CustomInfo%20xmlns%3axsd%3d%22http%3a%2f%2fwww.w3.org%2f2001%2fXMLSchema%22%20xmlns%3axsi%3d%22http%3a%2f%2fwww.w3.org%2f2001%2fXMLSchema-instance%22%3e%0a%20%20%3cbfAccountInfo%3e%0a%20%20%20%20%3cshow%3efalse%3c%2fshow%3e%0a%20%20%20%20%3cmoney%3e0%3c%2fmoney%3e%0a%20%20%20%20%3cxp%3e0%3c%2fxp%3e%0a%20%20%20%20%3cstreamer%3efalse%3c%2fstreamer%3e%0a%20%20%20%20%3cdeviceID%20%2f%3e%0a%20%20%20%20%3cclan%20%2f%3e%0a%20%20%20%20%3ccases%3e0%3c%2fcases%3e%0a%20%20%20%20%3ccases_CREDIT%3e0%3c%2fcases_CREDIT%3e%0a%20%20%20%20%3ccases_ADS%3e0%3c%2fcases_ADS%3e%0a%20%20%20%20%3ccases_OW%3e0%3c%2fcases_OW%3e%0a%20%20%20%20%3cgold_OW%3e0%3c%2fgold_OW%3e%0a%20%20%20%20%3cgold%3e0%3c%2fgold%3e%0a%20%20%20%20%3ctotalGoldBought%3e0%3c%2ftotalGoldBought%3e%0a%20%20%20%20%3chacker%3efalse%3c%2fhacker%3e%0a%20%20%20%20%3cv%3e1.0%3c%2fv%3e%0a%20%20%20%20%3cplatform%20%2f%3e%0a%20%20%20%20%3ctKills%3e0%3c%2ftKills%3e%0a%20%20%20%20%3ctDeaths%3e0%3c%2ftDeaths%3e%0a%20%20%20%20%3cmWon%3e0%3c%2fmWon%3e%0a%20%20%20%20%3cmLost%3e0%3c%2fmLost%3e%0a%20%20%20%20%3cknifeKills%3e0%3c%2fknifeKills%3e%0a%20%20%20%20%3cexplKills%3e0%3c%2fexplKills%3e%0a%20%20%20%20%3cnukes%3e0%3c%2fnukes%3e%0a%20%20%20%20%3chighStrk%3e0%3c%2fhighStrk%3e%0a%20%20%20%20%3cmostKills%3e0%3c%2fmostKills%3e%0a%20%20%20%20%3ccharacterCamos%20%2f%3e%0a%20%20%20%20%3cglovesCamos%20%2f%3e%0a%20%20%20%20%3cbulletTracerColors%20%2f%3e%0a%20%20%20%20%3ceLs%3e0%3c%2feLs%3e%0a%20%20%20%20%3cplayerID%3e0%3c%2fplayerID%3e%0a%20%20%20%20%3cnotificationMessage%20%2f%3e%0a%20%20%3c%2fbfAccountInfo%3e%0a%20%20%3cweaponInfo%3e%0a%20%20%20%20%3cBF_WeaponInfo%3e%0a%20%20%20%20%20%20%3cweapon%3e0%3c%2fweapon%3e%0a%20%20%20%20%20%20%3cunlocked%3e0%3c%2funlocked%3e%0a%20%20%20%20%20%20%3ccOL%20%2f%3e%0a%20%20%20%20%20%20%3caOL%20%2f%3e%0a%20%20%20%20%20%20%3csOL%20%2f%3e%0a%20%20%20%20%20%20%3cbOL%20%2f%3e%0a%20%20%20%20%20%20%3cc%20%2f%3e%0a%20%20%20%20%20%20%3ca%20%2f%3e%0a%20%20%20%20%20%20%3cs%20%2f%3e%0a%20%20%20%20%20%20%3cb%20%2f%3e%0a%20%20%20%20%20%20%3c%2fBF_WeaponInfo%3e%0a%20%20%3c%2fweaponInfo%3e%0a%20%20%3cthrowableInfo%3e%0a%20%20%20%20%3cBF_ThrowableInfo%3e%0a%20%20%20%20%20%20%3cweapon%3e0%3c%2fweapon%3e%0a%20%20%20%20%20%20%3cunlockedWeapon%3e0%3c%2funlockedWeapon%3e%0a%20%20%20%20%3c%2fBF_ThrowableInfo%3e%0a%20%20%3c%2fthrowableInfo%3e%0a%20%20%3cos%3enot%20set%3c%2fos%3e%0a%20%20%3cmodel%3enot%20set%3c%2fmodel%3e%0a%20%20%3crd%3e0%3c%2frd%3e%0a%20%20%3ced%3e0%3c%2fed%3e%0a%3c%2fAS_CustomInfo%3e%24%23%40(_fields_separator_*%26%25%5eclan%24%23%40(_field_name_value_separator_*%26%25%5e%24%23%40(_fields_separator_*%26%25%5eunbanned%24%23%40(_field_name_value_separator_*%26%25%5e0%24%23%40(_fields_separator_*%26%25%5e&requireEmailActivation=false&referralPlayer=&store=BALYZE_WEB&useJSON=true`,
        });

        if (response.status !== 200) {
            console.error('Failed to register account:', response.statusText);
            return { message: "fail", reason: response.statusText };
        }

        const responseData = await response.text();

        if (responseData.includes('success')) {
            return { message: "success", username: this.username, password: this.passwordNonHashed };
        } else {
            return { message: "fail", reason: responseData };
        }
    }
}

const proxies = [];

const filePath = `./proxies.txt`;

try {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  lines.forEach(line => {
    let proxy = line.trim();
    if (!proxy) return;

    let formatted = '';

    if (proxy.includes('@')) {
      formatted = `http://${proxy}`;
    } else {
      const parts = proxy.split(':');
      if (parts.length === 2) {
        formatted = `http://${DEFAULT_USER}:${DEFAULT_PASS}@${parts[0]}:${parts[1]}`;
      } else if (parts.length === 4) {
        const [ip, port, user, pass] = parts;
        formatted = `http://${user}:${pass}@${ip}:${port}`;
      } else {
        console.warn('Unrecognized proxy format:', proxy);
        return;
      }
    }

    proxies.push(formatted);
  });

  console.log('Formatted proxies:\n');
  console.log(proxies.map(p => `'${p}',`).join('\n'));
} catch (err) {
  console.error('Error reading proxies.txt:', err);
}

ipcRenderer.on('clear-player-list', (event) => {
    const playerListBody = document.getElementById('playerListBody');
    playerListBody.innerHTML = '';
});

// Initialize event listeners for checkbox changes
document.addEventListener('DOMContentLoaded', function() {
    const trackAllPlayers = document.getElementById('trackAllPlayers');
    const highlightLocalPlayer = document.getElementById('highlightLocalPlayer');
    
    if (trackAllPlayers) {
        trackAllPlayers.addEventListener('change', updatePlayerList);
    }
    
    if (highlightLocalPlayer) {
        highlightLocalPlayer.addEventListener('change', updatePlayerList);
    }
    
    // Add some CSS for the local player highlight
    const style = document.createElement('style');
    style.textContent = `
        .player-list {
            width: 100%;
            border-collapse: collapse;
        }
        .player-list th, .player-list td {
            padding: 5px;
            text-align: left;
            border-bottom: 1px solid #444;
        }
        .player-list tr:hover {
            background-color: #333;
        }
        .local-player {
            font-weight: bold;
        }
    `;
    document.head.appendChild(style);
});

ipcRenderer.on('update-player-list', (event, playerList) => {
    const playerListBody = document.getElementById('playerListBody');
    playerListBody.innerHTML = '';

    playerList.forEach(player => {
        const row = document.createElement('tr');

        const actorIdCell = document.createElement('td');
        actorIdCell.textContent = player.actorId;
        row.appendChild(actorIdCell);

        const viewIdCell = document.createElement('td');
        viewIdCell.textContent = player.viewId;
        row.appendChild(viewIdCell);

        const positionCell = document.createElement('td');
        positionCell.textContent = `x: ${player.vector3.x.toFixed(1)}, y: ${player.vector3.y.toFixed(1)}, z: ${player.vector3.z.toFixed(1)}`;
        row.appendChild(positionCell);

        const yawCell = document.createElement('td');
        yawCell.textContent = player.playerYaw ? player.playerYaw.toFixed(2) : 'N/A';
        row.appendChild(yawCell);

        const pitchCell = document.createElement('td');
        pitchCell.textContent = player.playerPitch ? player.playerPitch.toFixed(2) : 'N/A';
        row.appendChild(pitchCell);

        playerListBody.appendChild(row);
    });
});

// ===== Helper Functions =====

const consoleLog = document.getElementById('consoleLog');
function logToConsole(message, isError = false, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logElement = document.createElement('p');
    
    logElement.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> <span class="log-${type}">${message}</span>`;
    
    const consoleLog = document.getElementById('consoleLog');
    consoleLog.appendChild(logElement);
    consoleLog.scrollTop = consoleLog.scrollHeight;
}
function removeSelectedFromList(listId) {
    const list = document.getElementById(listId);
    const selectedIndex = list.selectedIndex;
    if (selectedIndex >= 0) {
        list.remove(selectedIndex);
    }
}

function addToListSmall(listId, value) {
    const list = document.getElementById(listId);
    const option = document.createElement("option");
    option.text = value;
    list.add(option);
}

function clearList(listId) {
    const list = document.getElementById(listId);
    list.innerHTML = "";
}

// Process Photon button
document.getElementById("processPhoton").addEventListener("click", async () => {
    const base64 = document.getElementById("photonBase64").value.trim();
    let packet;
    if (base64) {
        try {
            packet = PhotonPacket.fromBase64(base64);
            logToConsole("Successfully parsed packet:", packet);
        } catch (error) {
            logToConsole("Failed to parse packet: " + error);
            // Log the buffer contents for inspection
            console.log("Buffer content:", packet);
        }

        packet = PhotonPacket.fromBase64(base64);

        const serializePacket = JSON.parse(JSON.stringify(packet, (key, value) => {
            if (value instanceof Map) {
                return Array.from(value); 
            }
            return value;
        }));

        let packetScanner = new PacketScanner();
        logToConsole(`The packet was identified as a '${packetScanner.detectPacketType(serializePacket)}' packet!`);

        const fileName = `decoded_${Date.now()}.json`;

        fs.writeFileSync("DeserializedPackets/" + fileName, JSON.stringify(serializePacket, null, 2));

        addToList("photonFileList", fileName);
        logToConsole(`Processed Photon base64 and saved to: ${fileName}`);
    } else {
        logToConsole("Photon base64 input is empty.");
    }
});

function addToList(listId, fileName) {
    const list = document.getElementById(listId);
    if (!list) {
        console.log(`No list found with ID: ${listId}`);
        return;
    }
    console.log(`Adding item: ${fileName} to list: ${listId}`);

    const listItem = document.createElement("li");
    listItem.textContent = fileName;
    listItem.classList.add("file-item");

    listItem.addEventListener("contextmenu", (event) => {
        event.preventDefault();

        const existingMenu = document.querySelector(".context-menu");
        if (existingMenu) existingMenu.remove();

        const listBox = document.getElementById('photonFileList');
        const listBoxRect = listBox.getBoundingClientRect();

        const menu = createContextMenu(fileName);
        const fullFilePath = `DeserializedPackets/${fileName}`;

        let left = event.clientX - listBoxRect.left;
        let top = event.clientY - listBoxRect.top;

        const menuWidth = 150;
        const menuHeight = 90;
        if (left + menuWidth > listBoxRect.width) {
            left = listBoxRect.width - menuWidth;
        }
        if (top + menuHeight > listBoxRect.height) {
            top = listBoxRect.height - menuHeight;
        }

        menu.style.left = `${Math.max(0, left)}px`;
        menu.style.top = `${Math.max(0, top)}px`;

        listBox.appendChild(menu);

        const removeMenuHandler = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener("click", removeMenuHandler);
            }
        };
        document.addEventListener("click", removeMenuHandler);

        menu.querySelector(".delete").addEventListener("click", () => {
            try {
                fs.unlinkSync(fullFilePath);
                listItem.remove();
                logToConsole(`File deleted: ${fileName}`);
            } catch (err) {
                logToConsole(`Error deleting file: ${err.message}`);
            }
            menu.remove();
        });

        menu.querySelector(".open-location").addEventListener("click", () => {
            try {
                const dirPath = path.resolve("DeserializedPackets");
                require("child_process").exec(`explorer "${dirPath}"`);
            } catch (err) {
                logToConsole(`Error opening location: ${err.message}`);
            }
            menu.remove();
        });

        menu.querySelector(".edit").addEventListener("click", () => {
            try {
                require("child_process").exec(`notepad "${fullFilePath}"`);
            } catch (err) {
                logToConsole(`Error opening editor: ${err.message}`);
            }
            menu.remove();
        });
    });

    list.appendChild(listItem);
    list.scrollTop = list.scrollHeight;
}

let aceEditor;
let saveButton;

document.addEventListener("DOMContentLoaded", function () {
    const fileList = document.getElementById("photonFileList");

    // Handle right-click to show context menu
    fileList.addEventListener("contextmenu", function (event) {
        event.preventDefault(); // Prevent the default browser context menu

        if (event.target.tagName === "LI") {
            const selectedFile = event.target;
            const contextMenu = createContextMenu(selectedFile);

            contextMenu.style.top = `${event.pageY}px`;
            contextMenu.style.left = `${event.pageX}px`;
            contextMenu.style.display = "block";

            document.body.appendChild(contextMenu);

            function hideContextMenu(event) {
                if (contextMenu.contains(event.target)) return;
                contextMenu.remove();
                document.removeEventListener("click", hideContextMenu);
            }

            document.addEventListener("click", hideContextMenu);

            contextMenu.addEventListener("click", function (event) {
                if (event.target.classList.contains("delete")) {
                    logToConsole(`Deleted file: ${selectedFile.textContent}`);
                    const filePath = `DeserializedPackets/${selectedFile.textContent}`;
                    try {
                        fs.unlinkSync(filePath);
                        selectedFile.remove();
                        logToConsole(`Successfully deleted file from the filesystem: ${selectedFile.textContent}`);
                    } catch (err) {
                        logToConsole(`Error deleting file: ${err.message}`);
                    }
                } else if (event.target.classList.contains("edit")) {
                    createEditorWindow(selectedFile);
                } else if (event.target.classList.contains("open-location")) {
                    require("child_process").exec(`explorer "DeserializedPackets"`);
                }

                contextMenu.remove();
                hideContextMenu(event);
            });
        }
    });

    // Function to create the editor window
    function createEditorWindow(selectedFile) {
        // Create overlay
        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
        overlay.style.zIndex = "10001";
    
        // Create editor container
        const editorContainer = document.createElement("div");
        editorContainer.style.position = "absolute";
        editorContainer.style.top = "50%";
        editorContainer.style.left = "50%";
        editorContainer.style.transform = "translate(-50%, -50%)";
        editorContainer.style.backgroundColor = "rgba(40, 40, 45, 0.97)"; // Match var(--panel-bg)
        editorContainer.style.border = "1px solid rgba(70, 70, 80, 0.5)"; // Match var(--border-color)
        editorContainer.style.borderRadius = "12px";
        editorContainer.style.padding = "0";
        editorContainer.style.width = "80%";
        editorContainer.style.height = "90vh";
        editorContainer.style.display = "flex";
        editorContainer.style.flexDirection = "column";
        editorContainer.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.3)";
        editorContainer.style.overflow = "hidden";
        editorContainer.style.color = "#f0f0f0"; // Match var(--text-color)
        editorContainer.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
    
        // Title bar (matching the HTML style)
        const titleBar = document.createElement("div");
        titleBar.style.height = "38px";
        titleBar.style.backgroundColor = "rgba(25, 25, 30, 0.97)";
        titleBar.style.borderBottom = "1px solid rgba(80, 80, 95, 0.3)";
        titleBar.style.display = "flex";
        titleBar.style.justifyContent = "space-between";
        titleBar.style.alignItems = "center";
        titleBar.style.padding = "0 15px";
        titleBar.style.borderTopLeftRadius = "12px";
        titleBar.style.borderTopRightRadius = "12px";
    
        const title = document.createElement("div");
        title.textContent = `Editing: ${selectedFile.textContent}`;
        title.style.color = "#f0f0f0";
        title.style.fontWeight = "500";
        title.style.letterSpacing = "0.5px";
        title.style.display = "flex";
        title.style.alignItems = "center";

        const editorIcon = document.createElement("i");
        editorIcon.className = "fas fa-edit";
        editorIcon.style.marginRight = "8px";
        editorIcon.style.opacity = "0.8";
        title.prepend(editorIcon);
    
        const closeButton = document.createElement("div");
        closeButton.innerHTML = "×";
        closeButton.style.backgroundColor = "transparent";
        closeButton.style.border = "none";
        closeButton.style.color = "#ffffff";
        closeButton.style.fontSize = "24px";
        closeButton.style.cursor = "pointer";
        closeButton.style.padding = "0";
        closeButton.style.width = "28px";
        closeButton.style.height = "28px";
        closeButton.style.display = "flex";
        closeButton.style.alignItems = "center";
        closeButton.style.justifyContent = "center";
        closeButton.style.transition = "color 0.2s ease";
        closeButton.onmouseover = () => closeButton.style.color = "#fc6058";
        closeButton.onmouseout = () => closeButton.style.color = "#ffffff";
    
        titleBar.appendChild(title);
        titleBar.appendChild(closeButton);
    
        // Menu bar
        const menuBar = document.createElement("div");
        menuBar.style.backgroundColor = "rgba(28, 28, 33, 0.98)"; // Match var(--sidebar-bg)
        menuBar.style.padding = "5px 15px";
        menuBar.style.borderBottom = "1px solid rgba(80, 80, 95, 0.2)";
        menuBar.style.display = "flex";
        menuBar.style.gap = "15px";
        menuBar.style.position = "relative";
    
        const menuItems = [
            { name: "File", options: ["Save File", "Save File As"] },
            { name: "Edit", options: ["Undo", "Redo", "Clear File"] },
            { name: "Tools", options: ["Format JSON"] }
        ];
    
        menuItems.forEach(menu => {
            const menuItem = document.createElement("span");
            menuItem.textContent = menu.name;
            menuItem.style.color = "#f0f0f0";
            menuItem.style.cursor = "pointer";
            menuItem.style.padding = "6px 10px";
            menuItem.style.transition = "background 0.2s";
            menuItem.style.borderRadius = "4px";
            menuItem.onmouseover = () => {
                menuItem.style.backgroundColor = "rgba(60, 60, 70, 0.7)"; // Match var(--tab-hover)
            };
            menuItem.onmouseout = () => menuItem.style.backgroundColor = "transparent";
    
            // Dropdown
            const dropdown = document.createElement("div");
            dropdown.classList.add("dropdown");
            dropdown.style.position = "absolute";
            dropdown.style.backgroundColor = "rgba(40, 40, 45, 0.97)"; // Match var(--panel-bg)
            dropdown.style.border = "1px solid rgba(70, 70, 80, 0.5)"; // Match var(--border-color)
            dropdown.style.borderRadius = "6px";
            dropdown.style.display = "none";
            dropdown.style.zIndex = "10002";
            dropdown.style.padding = "5px 0";
            dropdown.style.minWidth = "140px";
            dropdown.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
    
            menu.options.forEach(option => {
                const optionItem = document.createElement("div");
                optionItem.textContent = option;
                optionItem.style.padding = "8px 12px";
                optionItem.style.color = "#f0f0f0";
                optionItem.style.cursor = "pointer";
                optionItem.style.transition = "background 0.2s";
                optionItem.onmouseover = () => {
                    optionItem.style.backgroundColor = "rgba(60, 60, 70, 0.7)"; // Match var(--tab-hover)
                };
                optionItem.onmouseout = () => optionItem.style.backgroundColor = "transparent";
    
                optionItem.onclick = (e) => {
                    e.stopPropagation();
                    handleMenuOption(menu.name, option, editor, selectedFile.textContent, overlay);
                    dropdown.style.display = "none";
                };
                dropdown.appendChild(optionItem);
            });
    
            menuItem.onclick = (e) => {
                e.stopPropagation();
                // Close all other dropdowns
                menuBar.querySelectorAll(".dropdown").forEach(d => {
                    if (d !== dropdown) d.style.display = "none";
                });
                dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
                dropdown.style.left = `${menuItem.offsetLeft}px`;
                dropdown.style.top = `${menuItem.offsetTop + menuItem.offsetHeight + 5}px`;
            };
    
            menuBar.appendChild(menuItem);
            menuBar.appendChild(dropdown);
        });
    
        // Editor wrapper
        const editorWrapper = document.createElement("div");
        editorWrapper.style.position = "relative";
        editorWrapper.style.display = "flex";
        editorWrapper.style.flex = "1";
        editorWrapper.style.margin = "15px";
        editorWrapper.style.borderRadius = "6px";
        editorWrapper.style.overflow = "hidden";
    
        const aceContainer = document.createElement("div");
        aceContainer.style.flex = "1";
        aceContainer.style.minHeight = "300px";
        aceContainer.style.backgroundColor = "rgba(20, 20, 25, 0.6)";
        aceContainer.style.border = "1px solid rgba(80, 80, 95, 0.3)";
        aceContainer.style.borderRadius = "6px";
        aceContainer.style.overflow = "hidden";
        editorWrapper.appendChild(aceContainer);
    
        // Bottom bar
        const bottomBar = document.createElement("div");
        bottomBar.style.padding = "15px";
        bottomBar.style.display = "flex";
        bottomBar.style.justifyContent = "flex-end";
        bottomBar.style.borderTop = "1px solid rgba(80, 80, 95, 0.2)";
        
        // Save button
        const saveButton = document.createElement("button");
        saveButton.textContent = "Save";
        saveButton.style.backgroundColor = "#3498db"; // Match var(--highlight-color)
        saveButton.style.color = "white";
        saveButton.style.border = "none";
        saveButton.style.borderRadius = "6px";
        saveButton.style.padding = "10px 20px";
        saveButton.style.cursor = "pointer";
        saveButton.style.fontWeight = "500";
        saveButton.style.transition = "background 0.2s ease";
        saveButton.style.display = "flex";
        saveButton.style.alignItems = "center";
        saveButton.style.gap = "8px";
        saveButton.onmouseover = () => saveButton.style.backgroundColor = "#2980b9";
        saveButton.onmouseout = () => saveButton.style.backgroundColor = "#3498db";
        
        // Create save icon
        const saveIcon = document.createElement("i");
        saveIcon.className = "fas fa-save";
        saveButton.prepend(saveIcon);
        
        bottomBar.appendChild(saveButton);
    
        // Load Ace Editor
        function initializeAceEditor() {
            // Create a status bar for the editor
            const statusBar = document.createElement("div");
            statusBar.className = "editor-status-bar";
            statusBar.innerHTML = '<span id="editorPosition">Line: 1, Column: 1</span><span style="margin-left: auto;">JSON</span>';
            
            // Add CSS classes to our editor elements
            editorContainer.className = "editor-window";
            titleBar.className = "editor-title-bar";
            menuBar.className = "editor-menu-bar";
            bottomBar.className = "editor-bottom-bar";
            aceContainer.className = "ace-editor-container";
            
            // Apply classes to menu items
            menuBar.querySelectorAll("span").forEach(item => {
                item.className = "editor-menu-item";
            });
            
            // Apply classes to dropdowns
            menuBar.querySelectorAll(".dropdown").forEach(dropdown => {
                dropdown.className = "editor-dropdown dropdown";
                dropdown.childNodes.forEach(option => {
                    option.className = "dropdown-option";
                });
            });
        
            // Initialize Ace editor
            aceEditor = ace.edit(aceContainer);
            aceEditor.setTheme("ace/theme/monokai");
            aceEditor.session.setMode("ace/mode/json");
            
            // Enhanced editor options
            aceEditor.setOptions({
                fontSize: "14px",
                fontFamily: "'Fira Code', 'Consolas', monospace",
                showPrintMargin: false,
                enableBasicAutocompletion: true,
                enableSnippets: true,
                enableLiveAutocompletion: true,
                highlightActiveLine: true,
                highlightSelectedWord: true,
                cursorStyle: "slim",
                scrollPastEnd: 0.5,
                fadeFoldWidgets: true,
                animatedScroll: true,
                showLineNumbers: true,
                showGutter: true,
                displayIndentGuides: true,
                tabSize: 2
            });
            
            // Add the status bar to the editor container before the bottom bar
            editorContainer.insertBefore(statusBar, bottomBar);
            
            // Update cursor position in status bar
            aceEditor.session.selection.on('changeCursor', function() {
                const position = aceEditor.getCursorPosition();
                document.getElementById('editorPosition').textContent = 
                    `Line: ${position.row + 1}, Column: ${position.column + 1}`;
            });
        
            const filePath = `DeserializedPackets/${selectedFile.textContent}`;
            saveButton.onclick = () => saveFile(filePath, aceEditor.getValue());
        
            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                aceEditor.setValue(fileContent, -1); // -1 disables cursor jump
                
                // Attempt to format JSON initially if it's valid
                try {
                    const json = JSON.parse(fileContent);
                    aceEditor.setValue(JSON.stringify(json, null, 2), -1);
                } catch (e) {
                    // Not valid JSON or already formatted, do nothing
                }
            } catch (err) {
                logToConsole(`Error loading file content: ${err.message}`);
                aceEditor.setValue('Error loading file content');
            }
        
            // Add highlighting for matching brackets
            aceEditor.session.setOption("matchBrackets", true);
            
            // Update menu options with editor reference
            menuItems.forEach(menu => {
                const dropdown = menuBar.querySelectorAll(".dropdown")[menuItems.indexOf(menu)];
                dropdown.childNodes.forEach(optionItem => {
                    optionItem.onclick = (e) => {
                        e.stopPropagation();
                        handleMenuOption(menu.name, optionItem.textContent, aceEditor, filePath, overlay);
                        dropdown.style.display = "none";
                    };
                });
            });
        }

        // Load Ace Editor if not already loaded
        if (typeof ace === 'undefined') {
            const script = document.createElement('script');
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ace.js";
            script.onload = () => {
                // Also load extensions
                const extScript = document.createElement('script');
                extScript.src = "https://cdnjs.cloudflare.com/ajax/libs/ace/1.4.12/ext-language_tools.js";
                extScript.onload = () => {
                    initializeAceEditor();
                };
                document.head.appendChild(extScript);
            };
            document.head.appendChild(script);
        } else {
            initializeAceEditor();
        }
    
        // Assemble editor
        editorContainer.appendChild(titleBar);
        editorContainer.appendChild(menuBar);
        editorContainer.appendChild(editorWrapper);
        editorContainer.appendChild(bottomBar);
        overlay.appendChild(editorContainer);
        document.body.appendChild(overlay);
    
        // Event handlers
        closeButton.onclick = () => overlay.remove();
        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
        };
    
        // Close dropdowns when clicking outside
        document.addEventListener("click", (e) => {
            menuBar.querySelectorAll(".dropdown").forEach(d => d.style.display = "none");
        });
    }
    
    // Helper functions
    function saveFile(filePath, content) {
        try {
            fs.writeFileSync(filePath, content, 'utf8');
            logToConsole(`File saved: ${path.basename(filePath)}`);
            
            // Show success notification
            showNotification("File saved successfully", "success");
        } catch (err) {
            logToConsole(`Error saving file: ${err.message}`);
            
            // Show error notification
            showNotification("Error saving file", "error");
        }
    }

    function showNotification(message, type) {
        const notification = document.createElement("div");
        notification.textContent = message;
        notification.className = `editor-notification ${type}-notification`;
        notification.style.position = "fixed";
        notification.style.bottom = "20px";
        notification.style.right = "20px";
        notification.style.padding = "12px 20px";
        notification.style.borderRadius = "6px";
        notification.style.color = "#fff";
        notification.style.zIndex = "10003";
        notification.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
        notification.style.fontSize = "14px";
        notification.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
        notification.style.display = "flex";
        notification.style.alignItems = "center";
        notification.style.gap = "8px";
        
        const icon = document.createElement("i");
        
        if (type === "success") {
            icon.className = "fas fa-check-circle";
        } else if (type === "error") {
            icon.className = "fas fa-exclamation-circle";
        } else {
            icon.className = "fas fa-info-circle";
        }
        
        notification.prepend(icon);
        document.body.appendChild(notification);
        
        // Remove notification after animation completes
        setTimeout(() => notification.remove(), 3000);
    }

    function handleMenuOption(menu, option, editor, filePath, overlay) {
        switch (menu) {
            case "File":
                if (option === "Save File") {
                    saveFile(filePath, editor.getValue());
                } else if (option === "Save File As") {
                    const fileName = path.basename(filePath);
                    const newFileName = `copy_${fileName}`;
                    const newPath = `DeserializedPackets/${newFileName}`;
                    saveFile(newPath, editor.getValue());
                    
                    // Add new file to list
                    const listItem = document.createElement("li");
                    listItem.textContent = newFileName;
                    fileList.appendChild(listItem);
                }
                break;
            case "Edit":
                if (option === "Undo") {
                    editor.undo();
                } else if (option === "Redo") {
                    editor.redo();
                } else if (option === "Clear File") {
                    editor.setValue("");
                }
                break;
            case "Tools":
                if (option === "Format JSON") {
                    try {
                        const json = JSON.parse(editor.getValue());
                        editor.setValue(JSON.stringify(json, null, 2));
                        showNotification("JSON formatted successfully", "success");
                    } catch (err) {
                        logToConsole(`Error formatting JSON: ${err.message}`);
                        showNotification("Invalid JSON format", "error");
                    }
                }
                break;
        }
    }
});

// Create context menu with options
function createContextMenu(selectedFile) {
    const menu = document.createElement("div");
    menu.classList.add("context-menu");
    menu.style.position = "absolute";
    menu.style.backgroundColor = "rgba(40, 40, 45, 0.97)"; // Match var(--panel-bg)
    menu.style.border = "1px solid rgba(70, 70, 80, 0.5)"; // Match var(--border-color)
    menu.style.padding = "5px 0";
    menu.style.zIndex = "10000";
    menu.style.minWidth = "160px";
    menu.style.borderRadius = "6px";
    menu.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
    menu.style.overflow = "hidden";

    const deleteOption = document.createElement("div");
    deleteOption.classList.add("menu-option", "delete");
    deleteOption.innerHTML = '<i class="fas fa-trash-alt" style="margin-right: 8px;"></i>Delete';
    deleteOption.style.padding = "10px 15px";
    deleteOption.style.cursor = "pointer";
    deleteOption.style.color = "#fc6058"; // Match close button color
    deleteOption.style.fontSize = "14px";
    deleteOption.style.transition = "background 0.2s";
    deleteOption.style.display = "flex";
    deleteOption.style.alignItems = "center";
    deleteOption.onmouseover = () => deleteOption.style.backgroundColor = "rgba(60, 60, 70, 0.7)"; // Match var(--tab-hover)
    deleteOption.onmouseout = () => deleteOption.style.backgroundColor = "transparent";

    const openLocationOption = document.createElement("div");
    openLocationOption.classList.add("menu-option", "open-location");
    openLocationOption.innerHTML = '<i class="fas fa-folder-open" style="margin-right: 8px;"></i>Open File Location';
    openLocationOption.style.padding = "10px 15px";
    openLocationOption.style.cursor = "pointer";
    openLocationOption.style.color = "#f0f0f0";
    openLocationOption.style.fontSize = "14px";
    openLocationOption.style.transition = "background 0.2s";
    openLocationOption.style.display = "flex";
    openLocationOption.style.alignItems = "center";
    openLocationOption.onmouseover = () => openLocationOption.style.backgroundColor = "rgba(60, 60, 70, 0.7)";
    openLocationOption.onmouseout = () => openLocationOption.style.backgroundColor = "transparent";

    const editOption = document.createElement("div");
    editOption.classList.add("menu-option", "edit");
    editOption.innerHTML = '<i class="fas fa-edit" style="margin-right: 8px;"></i>Edit';
    editOption.style.padding = "10px 15px";
    editOption.style.cursor = "pointer";
    editOption.style.color = "#3498db"; // Match var(--highlight-color)
    editOption.style.fontSize = "14px";
    editOption.style.transition = "background 0.2s";
    editOption.style.display = "flex";
    editOption.style.alignItems = "center";
    editOption.onmouseover = () => editOption.style.backgroundColor = "rgba(60, 60, 70, 0.7)";
    editOption.onmouseout = () => editOption.style.backgroundColor = "transparent";

    menu.appendChild(editOption);
    menu.appendChild(openLocationOption);
    menu.appendChild(deleteOption);

    return menu;
}

// Add FontAwesome if not already loaded
if (!document.querySelector('link[href*="font-awesome"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
    document.head.appendChild(link);
}

document.addEventListener('DOMContentLoaded', function() {
    // Tab Management - FIXED CODE HERE
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    function switchTab(targetTab) {
        // Remove active class from all tabs and contents
        tabs.forEach(tab => tab.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));

        // Add active class to clicked tab
        targetTab.classList.add('active');

        // Find and activate the corresponding content
        const tabId = targetTab.getAttribute('data-tab');
        const contentToShow = document.getElementById(`${tabId}-content`);
        if (contentToShow) {
            contentToShow.classList.add('active');
            const chatBox = document.getElementById("lobbyChatLog");
            chatBox.scrollTop = chatBox.scrollHeight;
            const requestList = document.getElementById("requestList");
            requestList.scrollTop = requestList.scrollHeight;
        } else {
            console.error(`Content not found for tab: ${tabId}`);
            logToConsole(`Error: Content not found for tab: ${tabId}`, true);
        }
    }

    // Add click handlers to tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            switchTab(this);
        });
    });

    // MITM Connection Management
    const connectionStatus = document.getElementById('connectionStatus');
    const statusIndicator = document.querySelector('.status-indicator');
    const startServerBtn = document.getElementById('startServer');
    const stopServerBtn = document.getElementById('stopServer');
    
    // Initialize the stop button as disabled
    stopServerBtn.disabled = true;

    function updateConnectionStatus(isConnected) {
        if (isConnected) {
            connectionStatus.textContent = 'Connected';
            connectionStatus.style.color = '#34c749';
            statusIndicator.classList.remove('status-off');
            statusIndicator.classList.add('status-on');
            startServerBtn.disabled = true;
            stopServerBtn.disabled = false;
        } else {
            connectionStatus.textContent = 'Not Connected';
            connectionStatus.style.color = '#fc6058';
            statusIndicator.classList.remove('status-on');
            statusIndicator.classList.add('status-off');
            startServerBtn.disabled = false;
            stopServerBtn.disabled = true;
        }
    }

    startServerBtn.addEventListener('click', function() {
        try {
            updateConnectionStatus(true);
            logToConsole('MITM Server started successfully');
        } catch (error) {
            logToConsole(`Error starting server: ${error.message}`, true);
        }
    });

    stopServerBtn.addEventListener('click', function() {
        try {
            updateConnectionStatus(false);
            logToConsole('MITM Server stopped');
        } catch (error) {
            logToConsole(`Error stopping server: ${error.message}`, true);
        }
    });

    // Rank Slider
    const rankSlider = document.getElementById('rankSlider');
    const rankValue = document.getElementById('rankValue');

    rankSlider.addEventListener('input', function() {
        rankValue.textContent = this.value;
        logToConsole(`Rank value set to: ${this.value}`);
    });

    // Photon Processing
    const processPhotonBtn = document.getElementById('processPhoton');
    processPhotonBtn.addEventListener('click', function() {
        const photonInput = document.getElementById('photonBase64').value;
        try {
            if (photonInput) {
                // Add to request list
                const requestList = document.getElementById('requestList');
                const option = document.createElement('option');
                option.text = `Request @ ${new Date().toLocaleTimeString()}`;
                requestList.add(option);
                
                logToConsole('Processing Photon Base64 data');
                document.getElementById('photonBase64').value = '';
            } else {
                logToConsole('No Base64 data provided', true);
            }
        } catch (error) {
            logToConsole(`Photon processing error: ${error.message}`, true);
        }
    });

    // Account Generation
    document.getElementById("generateAccount").addEventListener("click", async () => {
        const username = document.getElementById("username").value.trim();
        const password = document.getElementById("password").value.trim();

        if (username && password) {
            const requestDetails = `[Pending]: Register ${username}:${password}`;
            addToListSmall("requestList", requestDetails);

            let account = new Account(username, password, proxies);
            let response = await account.generateAccount();

            const requestList = document.getElementById("requestList");
            
            if (requestList.options.length > 0) {
                const lastRequest = requestList.options[requestList.options.length - 1];

                if (response.message == "success") {
                    logToConsole(`[${response.message.toUpperCase()}]: Generated account: ${username}:${password}`);
                    lastRequest.textContent = `[Success]: Register ${username}:${password}`;
                    addToListSmall("accountList", `${username}:${password}`);
                } else {
                    logToConsole(`[${response.message.toUpperCase()}]: Failed to generate account -> ${response.reason}`);
                    lastRequest.textContent = `[Fail]: Register ${username}:${password}`;
                }
            } else {
                logToConsole("No requests to update.");
            }
        } else {
            logToConsole("Username or Password is missing.");
        }
    });

    setInterval(async () => {
        try {
            let chatPacket = new ChatV2("opAccountant", "LmaoXd12@!", proxies);
            let jsonChat = await chatPacket.get();

            const chatBox = document.getElementById("lobbyChatLog");

            // Clear the chat box and append new messages
            chatBox.innerHTML = '';
            jsonChat.messages.forEach(chatMessage => {
                const messageDiv = document.createElement("div");
                messageDiv.classList.add("chat-message");
                messageDiv.innerHTML = `${chatMessage.message}`;
                chatBox.appendChild(messageDiv);
            });

            // Scroll to bottom
            chatBox.scrollTop = chatBox.scrollHeight;
        } catch (err) {
            console.error(err);
        }
    }, 5000);

    // Send Chat Message button
    document.getElementById("sendMessage").addEventListener("click", async () => {
        const accountList = document.getElementById("accountList");
        const selectedIndex = accountList.selectedIndex;

        // Get the message from the input field
        const message = document.getElementById("sendChatMessage").value.trim();

        if (selectedIndex >= 0) {
            const selectedAccount = accountList.options[selectedIndex].text;
            const [username, password] = selectedAccount.split(":");

            if (username && password && message) {
                const requestList = document.getElementById("requestList");

                // Add [Pending] request entry
                const pendingOption = document.createElement("option");
                pendingOption.textContent = `[Pending]: (POST) ChatV2.send`;
                requestList.appendChild(pendingOption);
                requestList.scrollTop = requestList.scrollHeight;

                try {
                    let chatPacket = new ChatV2(username, password, proxies);
                    chatPacket.send(message);
                    logToConsole(`Sent message as ${username}: ${message}`);

                    // Update request status to [Success]
                    pendingOption.textContent = `[Success]: (POST) ChatV2.send`;
                    requestList.scrollTop = requestList.scrollHeight;
                } catch (err) {
                    // Update request status to [Failed]
                    pendingOption.textContent = `[Failed]: (POST) ChatV2.send`;
                    requestList.scrollTop = requestList.scrollHeight;
                    logToConsole(`Error sending message: ${err.message}`);
                }
            } else {
                if (!message) {
                    logToConsole("Message is empty.");
                } else {
                    logToConsole("Invalid account format.");
                }
            }
        } else {
            logToConsole("No account selected.");
        }
    });

    
    // Checkbox Event Listeners
    spinBotCheckbox.addEventListener("change", () => {
        logToConsole("Spin Bot: " + spinBotCheckbox.checked);
        mainSocket.send(JSON.stringify({
            "command": "set",
            "key": "spinbot",
            "value": spinBotCheckbox.checked
        }));
    });

    pingSpoofCheckbox.addEventListener("change", () => {
        logToConsole("Ping Spoof: " + pingSpoofCheckbox.checked);
        mainSocket.send(JSON.stringify({
            "command": "set",
            "key": "pingspoof",
            "value": pingSpoofCheckbox.checked
        }));
    });

    slideCheckbox.addEventListener("change", () => {
        logToConsole("Slide: " + slideCheckbox.checked);
        mainSocket.send(JSON.stringify({
            "command": "set",
            "key": "slide",
            "value": slideCheckbox.checked
        }));
    });

    rank232SpoofCheckbox.addEventListener("change", () => {
        logToConsole("Rank 232 Spoof: " + rank232SpoofCheckbox.checked);
        mainSocket.send(JSON.stringify({
            "command": "set",
            "key": "rank",
            "value": 232
        }));
    });

    rank0SpoofCheckbox.addEventListener("change", () => {
        logToConsole("Rank 0 Spoof: " + rank0SpoofCheckbox.checked);
        mainSocket.send(JSON.stringify({
            "command": "set",
            "key": "rank",
            "value": 0
          }));
    });

    rank255SpoofCheckbox.addEventListener("change", () => {
        logToConsole("Rank 255 Spoof: " + rank255SpoofCheckbox.checked);
        mainSocket.send(JSON.stringify({
            "command": "set",
            "key": "rank",
            "value": 255
        }));
    });

    let clanTagTimeout;

    document.getElementById("clanTag").addEventListener("input", function(event) {
        clearTimeout(clanTagTimeout); // Reset timeout on every keypress
    
        clanTagTimeout = setTimeout(() => {
            logToConsole("Clan Tag changed to: " + event.target.value);
            mainSocket.send(JSON.stringify({
                "command": "set",
                "key": "clantag",
                "value": event.target.value
            }));
        }, 500);
    });    

    rank222SpoofCheckbox.addEventListener("change", () => {
        logToConsole("Rank 222 Spoof: " + rank222SpoofCheckbox.checked);
        mainSocket.send(JSON.stringify({
            "command": "set",
            "key": "rank",
            "value": 222
        }));
    });

    // Tool Items
    document.querySelectorAll('.tool-item').forEach(item => {
        item.addEventListener('click', function() {
            logToConsole(`Tool activated: ${this.textContent.trim()}`);
        });
    });

    // Initialize
    updateConnectionStatus(false);
    logToConsole('Panel initialized successfully');
});

function startServer() {
    server = new WebSocket.Server({ port: 8080 }, () => {
        logToConsole('MITM WebSocket server started on ws://localhost:8080');
        setWaiting();
    });
  
    server.on('connection', (clientWs) => {
        logToConsole('New client connected to the MITM server');
        setConnected(true);

        mainSocket = clientWs;
  
        clientWs.on('message', (message) => {
            const jsonMessage = JSON.parse(message);
            
            if (playerDataPacketSaver && jsonMessage.type === "PLAYER_DATA") {
                let packet = PhotonPacket.fromBase64(jsonMessage.base64);
                const serializePacket = JSON.parse(JSON.stringify(packet, (key, value) => {
                    if (value instanceof Map) {
                        return Array.from(value); 
                    }
                    return value;
                }));
        
                const fileName = `PLR_DATA_${Date.now()}.json`;
                fs.writeFileSync("DeserializedPackets/" + fileName, JSON.stringify(serializePacket, null, 2));
        
                addToList("photonFileList", fileName);
                // logToConsole(`Processed Photon base64 and saved to: ${fileName}`);
            }

            if (movementPacketSaver && jsonMessage.type === "MOVEMENT_DATA") {
                let packet = PhotonPacket.fromBase64(jsonMessage.base64);
                const serializePacket = JSON.parse(JSON.stringify(packet, (key, value) => {
                    if (value instanceof Map) {
                        return Array.from(value); 
                    }
                    return value;
                }));
        
                const fileName = `MVMNT_DATA_${Date.now()}.json`;
                logToConsole(`Health from packet -> ${grabHealthFromPacket(serializePacket)} / ${grabHealthFromPacket(serializePacket) / 100}!`);

                fs.writeFileSync("DeserializedPackets/" + fileName, JSON.stringify(serializePacket, null, 2));
        
                addToList("photonFileList", fileName);
                logToConsole(`Processed Photon base64 and saved to: ${fileName}`);
            }
        });
    
        clientWs.on('close', () => {
            logToConsole('Client disconnected');
            setWaiting();
        });
    });
  }
  
function stopServer() {
    if (server) {
        server.close(() => {
            logToConsole('MITM WebSocket server stopped');
            setConnected(false);
        });
    } else {
        logToConsole('MITM WebSocket server is not running');
        setConnected(false);
    }
}

function readFolderAndAddToList(folderPath) {
    fs.readdir(folderPath, (err, files) => {
        if (err) {
            console.error("Error reading folder:", err);
            return;
        }

        const fileStatsPromises = files.map(fileName => {
            const fullPath = path.join(folderPath, fileName);
            return new Promise((resolve, reject) => {
                fs.stat(fullPath, (err, stats) => {
                    if (err) return reject(err);
                    if (stats.isFile()) {
                        resolve({ fileName, time: stats.mtime });
                    } else {
                        resolve(null);
                    }
                });
            });
        });

        Promise.all(fileStatsPromises)
            .then(results => {
                const sortedFiles = results
                    .filter(entry => entry !== null)
                    .sort((a, b) => a.time - b.time);

                sortedFiles.forEach(({ fileName }) => {
                    addToList("photonFileList", fileName);
                });
            })
            .catch(err => {
                console.error("Error getting file stats:", err);
            });
    });
}


document.addEventListener("DOMContentLoaded", () => {
    startServer();
    readFolderAndAddToList("./DeserializedPackets/");
    // Start and Stop Server Buttons
    const startServerButton = document.getElementById("startServer");
    const stopServerButton = document.getElementById("stopServer");

    const saveMovementPackets = document.getElementById("saveMovementPackets");
    const savePlayerDataPackets = document.getElementById("savePlayerDataPackets");

    // Start Server Button Event Listener
    startServerButton.addEventListener("click", () => {
        startServer();
    });

    // Stop Server Button Event Listener
    stopServerButton.addEventListener("click", () => {
        stopServer();
    });

    saveMovementPackets.addEventListener("change", () => {
        movementPacketSaver = saveMovementPackets.checked;
    });

    savePlayerDataPackets.addEventListener("change", () => {
        playerDataPacketSaver = savePlayerDataPackets.checked;
    });
});
