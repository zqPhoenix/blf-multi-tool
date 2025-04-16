console.log('[game.js] Script loaded');

const originalFetch = window.fetch || fetch;

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

let requestQueue = [];
let mainWindowReadyChecked = false;

window.addToRequestListLocal = async function(requestText) {
    console.log('[addToRequestListLocal] Called with:', requestText);
    if (mainWindowReadyChecked) {
        const success = await window.addToRequestList(requestText);
        if (success) {
            console.log(`[addToRequestListLocal] Added "${requestText}" to requestList via IPC`);
        } else {
            console.log(`[addToRequestListLocal] Failed to add "${requestText}" to requestList`);
        }
    } else {
        if (!requestQueue.includes(requestText)) {
            console.log(`[addToRequestListLocal] Queueing "${requestText}" until main window is ready`);
            requestQueue.push(requestText);
        }
    }
};

window.updateRequestStatus = async function(originalText, status) {
    const updatedText = `${status} ${originalText.slice(originalText.indexOf(')') + 2)}`;
    console.log('[updateRequestStatus] Updating:', originalText, 'to', updatedText);
    const success = await window.updateRequestList(originalText, updatedText);
    if (success) {
        console.log(`[updateRequestStatus] Updated "${originalText}" to "${updatedText}"`);
    } else {
        console.log(`[updateRequestStatus] Failed to update "${originalText}"`);
    }
};

// Photon Shit
window.actorIds = [];

// Create a canvas element for ESP boxes
const espCanvas = document.createElement('canvas');
espCanvas.id = 'espOverlay';
espCanvas.style.position = 'absolute';
espCanvas.style.top = '0';
espCanvas.style.left = '0';
espCanvas.style.width = '100%';
espCanvas.style.height = '100%';
espCanvas.style.pointerEvents = 'none'; // Let clicks pass through
espCanvas.style.zIndex = '1000'; // Make sure it's on top of other elements
document.body.appendChild(espCanvas);

// Set canvas size to match window
function resizeCanvas() {
  espCanvas.width = window.innerWidth;
  espCanvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Camera/viewport settings (you'll need to adjust these to match your game)
const camera = {
  position: { x: 0, y: 0, z: 0 },
  fov: 90,
  aspectRatio: window.innerWidth / window.innerHeight
};

// Function to convert 3D world position to 2D screen position
function worldToScreen(position) {
  // This is a simplified projection - you'll need to adjust this based on your game's coordinate system
  // Distance from camera to player
  const dx = position.x - camera.position.x;
  const dy = position.y - camera.position.y;
  const dz = position.z - camera.position.z;
  
  // Simple perspective projection
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 0.1) return null; // Behind camera or too close
  
  // Convert to screen coordinates
  const scale = (1 / Math.tan(camera.fov * 0.5 * Math.PI / 180)) / distance;
  const x = (dx * scale * camera.aspectRatio) * (espCanvas.width * 0.5) + (espCanvas.width * 0.5);
  const y = -(dy * scale) * (espCanvas.height * 0.5) + (espCanvas.height * 0.5);
  
  // Player size decreases with distance (adjust as needed)
  const boxSize = 100 / (distance * 0.1);
  
  return {
    x: x,
    y: y,
    distance: distance,
    boxSize: boxSize
  };
}

// Update ESP function (called whenever player list updates)
function updateESP(playerList) {
  const ctx = espCanvas.getContext('2d');
  ctx.clearRect(0, 0, espCanvas.width, espCanvas.height);
  
  // Get local player position (if available)
  // You would need to set this somewhere in your code
  // camera.position = getLocalPlayerPosition();
  
  playerList.forEach(player => {
    // Skip drawing ESP for local player if needed
    // if (player.actorId === localPlayerId) return;
    
    const playerPos = { 
      x: player.vector3.x, 
      y: player.vector3.y, 
      z: player.vector3.z 
    };
    
    const screenPos = worldToScreen(playerPos);
    
    // Only draw if player is visible on screen
    if (screenPos) {
      // Calculate box dimensions
      const boxWidth = screenPos.boxSize;
      const boxHeight = screenPos.boxSize * 2; // Players are usually taller than wide
      
      // Draw ESP box
      ctx.beginPath();
      ctx.rect(
        screenPos.x - boxWidth/2, 
        screenPos.y - boxHeight/2, 
        boxWidth, 
        boxHeight
      );
      
      // Color based on distance (red = close, green = far)
      const distanceColor = Math.min(255, screenPos.distance * 5);
      ctx.strokeStyle = `rgb(${255 - distanceColor}, ${distanceColor}, 0)`;
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw player ID or name
      ctx.fillStyle = 'white';
      ctx.font = '12px Arial';
      ctx.fillText(
        `Player ${player.actorId}`, 
        screenPos.x - boxWidth/2, 
        screenPos.y - boxHeight/2 - 5
      );
      
      // Draw distance
      ctx.fillText(
        `${screenPos.distance.toFixed(1)}m`, 
        screenPos.x - boxWidth/2, 
        screenPos.y + boxHeight/2 + 15
      );
    }
  });
}

window.fetch = async function (input, init = {}) {
    const requestUrl = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    const resourceName = "/" + requestUrl.split('/').pop().split('?')[0];
    const formattedRequest = `(${method}) ${resourceName}`;
    const pendingRequest = `[Pending] ${formattedRequest}`;
    console.log('[fetch]', pendingRequest);

    if (requestUrl.toLowerCase().includes("get-player-punishment.php")) {
        console.log(requestUrl);
        ipcRenderer.send('player-list-clear');
    }

    await window.addToRequestListLocal(pendingRequest);
    try {
        const response = await originalFetch(input, init);
        await window.updateRequestStatus(pendingRequest, `[Success] (${method})`);
        return response;
    } catch (err) {
        await window.updateRequestStatus(pendingRequest, `[Fail] (${method}) ${resourceName}`);
        console.error('[fetch] Error:', err);
        throw err;
    }
};

async function waitForMainWindow(maxAttempts = 15, delayMs = 1000) {
    console.log('[waitForMainWindow] Starting');
    let attempts = 0;
    while (attempts <= maxAttempts) {
        console.log(`[waitForMainWindow] Polling attempt ${attempts + 1}: window.mainWindowReady = ${window.mainWindowReady}`);
        if (window.mainWindowReady) {
            mainWindowReadyChecked = true;
            console.log('[waitForMainWindow] Main window ready');
            return true;
        }
        attempts++;
        if (attempts > maxAttempts) {
            console.log('[waitForMainWindow] Max attempts reached, main window still not available');
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }
}

async function init() {
    console.log('[init] Starting');
    const ready = await waitForMainWindow();
    if (ready && requestQueue.length > 0) {
        console.log('[init] mainWindow ready, processing queue:', requestQueue);
        for (const requestText of requestQueue) {
            await window.addToRequestListLocal(requestText);
        }
        requestQueue = [];
    } else if (!ready) {
        console.log('[init] Main window is not available after polling');
        return;
    }
    const addRequestBtn = document.getElementById('addRequestBtn');
    if (addRequestBtn) {
        addRequestBtn.addEventListener('click', async () => {
            const requestText = `Request at ${new Date().toLocaleTimeString()}`;
            await window.addToRequestListLocal(requestText);
        });
    } else {
        console.log('[init] addRequestBtn not found in DOM');
    }
}

init();

document.addEventListener('DOMContentLoaded', () => {
    console.log('[game.js] DOMContentLoaded');
    if (!mainWindowReadyChecked) {
        init();
    }
});