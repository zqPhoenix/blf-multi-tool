/** Optimized Photon Protocol - Compact Version */
const PhotonConstants = {
    MAGIC: { GP_BINARY_V2: 0xF3, AMF3_V2: 0xF4, INIT_V2_POST: 0x50, INIT_V2_GET: 0x47, PING: 0xF0 },
    TYPE: { REQUEST: 2, RESPONSE: 3, EVENT: 4, MESSAGE: 6, MESSAGE_RETURN: 7 },
    VALUE_TYPE: {
        NULL: 0x2A, DICTIONARY: 0x44, STRING_ARRAY: 0x61, BYTE: 0x62, CUSTOM_DATA: 0x63, DOUBLE: 0x64,
        FLOAT: 0x66, HASH_TABLE: 0x68, INTEGER: 0x69, SHORT: 0x6B, LONG: 0x6C, INT_ARRAY: 0x6E,
        BOOLEAN: 0x6F, OP_RESPONSE: 0x70, OP_REQUEST: 0x71, STRING: 0x73, BYTE_ARRAY: 0x78,
        ARRAY: 0x79, OBJECT_ARRAY: 0x7A
    },
    CUSTOM_DATA: { VEC2: 'W', VEC3: 'V', QUAT: 'Q', PLAYER: 'P' }
};

class PhotonReader {
    constructor(buffer) {
        this.view = new DataView(buffer.buffer || buffer);
        this.offset = 0;
        this.length = this.view.byteLength;
    }

    checkSpace(bytes) { if (this.offset + bytes > this.length) throw new Error(`Buffer underrun at ${this.offset}`); }

    readUint8() { this.checkSpace(1); return this.view.getUint8(this.offset++); }
    readUint16() { this.checkSpace(2); const v = this.view.getUint16(this.offset); this.offset += 2; return v; }
    readUint32() { this.checkSpace(4); const v = this.view.getUint32(this.offset); this.offset += 4; return v; }
    readInt32() { this.checkSpace(4); const v = this.view.getInt32(this.offset); this.offset += 4; return v; }
    readFloat() { this.checkSpace(4); const v = this.view.getFloat32(this.offset); this.offset += 4; return v; }
    readDouble() { this.checkSpace(8); const v = this.view.getFloat64(this.offset); this.offset += 8; return v; }
    readBytes(n) { this.checkSpace(n); const r = new Uint8Array(this.view.buffer, this.offset, n); this.offset += n; return r; }
    readString() { const len = this.readUint16(); return len ? new TextDecoder().decode(this.readBytes(len)) : ''; }

    readTypedArray(lenReader, itemReader) {
        const len = lenReader.call(this), arr = new Array(len);
        for (let i = 0; i < len; i++) arr[i] = itemReader.call(this);
        return arr;
    }

    readValue(type = this.readUint8()) {
        try {
            switch (type) {
                case PhotonConstants.VALUE_TYPE.NULL: return null;
                case PhotonConstants.VALUE_TYPE.BYTE: return this.readUint8();
                case PhotonConstants.VALUE_TYPE.SHORT: return this.readUint16();
                case PhotonConstants.VALUE_TYPE.INTEGER: return this.readUint32();
                case PhotonConstants.VALUE_TYPE.LONG: return this.view.getBigUint64(this.offset, false, this.offset += 8);
                case PhotonConstants.VALUE_TYPE.FLOAT: return this.readFloat();
                case PhotonConstants.VALUE_TYPE.DOUBLE: return this.readDouble();
                case PhotonConstants.VALUE_TYPE.BOOLEAN: return this.readUint8() !== 0;
                case PhotonConstants.VALUE_TYPE.STRING: return this.readString();
                case PhotonConstants.VALUE_TYPE.BYTE_ARRAY: return this.readBytes(this.readUint32());
                case PhotonConstants.VALUE_TYPE.INT_ARRAY: return this.readTypedArray(this.readUint32, this.readInt32);
                case PhotonConstants.VALUE_TYPE.STRING_ARRAY: return this.readTypedArray(this.readUint16, this.readString);
                case PhotonConstants.VALUE_TYPE.ARRAY: return this.readTypedArray(this.readUint16, () => this.readValue(this.readUint8()));
                case PhotonConstants.VALUE_TYPE.OBJECT_ARRAY: return this.readTypedArray(this.readUint16, this.readValue);
                case PhotonConstants.VALUE_TYPE.HASH_TABLE: return this.readTypedArray(this.readUint16, () => [this.readValue(), this.readValue()]).reduce((m, [k, v]) => m.set(k, v), new Map());
                case PhotonConstants.VALUE_TYPE.DICTIONARY: {
                    const [kt, vt, len] = [this.readUint8(), this.readUint8(), this.readUint16()];
                    return this.readTypedArray(() => len, () => [this.readValue(kt || null), this.readValue(vt || null)])
                        .reduce((m, [k, v]) => m.set(k, v), new Map());
                }
                case PhotonConstants.VALUE_TYPE.CUSTOM_DATA: return this.readCustom(this.readUint8(), this.readUint16());
                case PhotonConstants.VALUE_TYPE.OP_REQUEST: return { opCode: this.readUint8(), params: this.readHashTable() };
                case PhotonConstants.VALUE_TYPE.OP_RESPONSE: return { opCode: this.readUint8(), code: this.readUint16(), params: this.readHashTable() };
                default: console.warn(`Unknown type: ${type}`); return null;
            }
        } catch (e) { console.error(`Error reading type ${type}: ${e.message}`); return null; }
    }

    readCustom(code, len) {
        const variant = String.fromCharCode(code);
        switch (variant) {
            case PhotonConstants.CUSTOM_DATA.VEC2: return { x: this.readFloat(), y: this.readFloat() };
            case PhotonConstants.CUSTOM_DATA.VEC3: return { x: this.readFloat(), y: this.readFloat(), z: this.readFloat() };
            case PhotonConstants.CUSTOM_DATA.QUAT: return { w: this.readFloat(), x: this.readFloat(), y: this.readFloat(), z: this.readFloat() };
            case PhotonConstants.CUSTOM_DATA.PLAYER: return { playerId: this.readUint32() };
            default: this.offset += len; console.warn(`Unknown custom type: ${variant}`); return null;
        }
    }
}

class PhotonWriter {
    constructor(size = 1024) {
        this.view = new DataView(new ArrayBuffer(size));
        this.offset = 0;
    }

    ensure(n) {
        if (this.offset + n > this.view.byteLength) {
            const newBuf = new ArrayBuffer(Math.max(this.view.byteLength * 2, this.offset + n));
            new Uint8Array(newBuf).set(new Uint8Array(this.view.buffer));
            this.view = new DataView(newBuf);
        }
    }

    writeUint8(v) { this.ensure(1); this.view.setUint8(this.offset++, v); return this; }
    writeUint16(v) { this.ensure(2); this.view.setUint16(this.offset, v); this.offset += 2; return this; }
    writeUint32(v) { this.ensure(4); this.view.setUint32(this.offset, v); this.offset += 4; return this; }
    writeInt32(v) { this.ensure(4); this.view.setInt32(this.offset, v); this.offset += 4; return this; }
    writeFloat(v) { this.ensure(4); this.view.setFloat32(this.offset, v); this.offset += 4; return this; }
    writeDouble(v) { this.ensure(8); this.view.setFloat64(this.offset, v); this.offset += 8; return this; }
    writeBytes(v) { const b = new Uint8Array(v); this.ensure(b.length); new Uint8Array(this.view.buffer).set(b, this.offset); this.offset += b.length; return this; }
    writeString(v) { const b = new TextEncoder().encode(v); this.writeUint16(b.length).writeBytes(b); return this; }
    getBuffer() { return this.view.buffer.slice(0, this.offset); }

    writeValue(v, type = true) {
        if (v === null) return type && this.writeUint8(PhotonConstants.VALUE_TYPE.NULL);
        const t = v.type || this.inferType(v);
        if (type) this.writeUint8(t);
        switch (t) {
            case PhotonConstants.VALUE_TYPE.BYTE: this.writeUint8(v); break;
            case PhotonConstants.VALUE_TYPE.SHORT: this.writeUint16(v); break;
            case PhotonConstants.VALUE_TYPE.INTEGER: this.writeUint32(v); break;
            case PhotonConstants.VALUE_TYPE.FLOAT: this.writeFloat(v); break;
            case PhotonConstants.VALUE_TYPE.DOUBLE: this.writeDouble(v); break;
            case PhotonConstants.VALUE_TYPE.BOOLEAN: this.writeUint8(v ? 1 : 0); break;
            case PhotonConstants.VALUE_TYPE.STRING: this.writeString(v); break;
            case PhotonConstants.VALUE_TYPE.BYTE_ARRAY: this.writeUint32(v.length).writeBytes(v); break;
            case PhotonConstants.VALUE_TYPE.INT_ARRAY: this.writeUint32(v.length); v.forEach(x => this.writeInt32(x)); break;
            case PhotonConstants.VALUE_TYPE.STRING_ARRAY: this.writeUint16(v.length); v.forEach(x => this.writeString(x)); break;
            case PhotonConstants.VALUE_TYPE.ARRAY: this.writeUint16(v.length); v.forEach(x => this.writeValue(x)); break;
            case PhotonConstants.VALUE_TYPE.OBJECT_ARRAY: this.writeUint16(v.length); v.forEach(x => this.writeValue(x)); break;
            case PhotonConstants.VALUE_TYPE.HASH_TABLE: this.writeUint16(v.size); for (const [k, val] of v) this.writeValue(k).writeValue(val); break;
            case PhotonConstants.VALUE_TYPE.DICTIONARY: this.writeUint8(v.keyType).writeUint8(v.valueType).writeUint16(v.map.size); for (const [k, val] of v.map) this.writeValue(k).writeValue(val); break;
            case PhotonConstants.VALUE_TYPE.CUSTOM_DATA: this.writeCustom(v); break;
            default: console.error(`Unsupported type: ${t}`); break;
        }
        return this;
    }

    writeCustom(v) {
        this.writeUint8(v.variant.charCodeAt(0));
        switch (v.variant) {
            case PhotonConstants.CUSTOM_DATA.VEC2: this.writeFloat(v.value.x).writeFloat(v.value.y); break;
            case PhotonConstants.CUSTOM_DATA.VEC3: this.writeFloat(v.value.x).writeFloat(v.value.y).writeFloat(v.value.z); break;
            case PhotonConstants.CUSTOM_DATA.QUAT: this.writeFloat(v.value.w).writeFloat(v.value.x).writeFloat(v.value.y).writeFloat(v.value.z); break;
            case PhotonConstants.CUSTOM_DATA.PLAYER: this.writeUint32(v.value.playerId); break;
        }
    }

    inferType(v) {
        if (typeof v === 'number') return PhotonConstants.VALUE_TYPE.INTEGER;
        if (typeof v === 'string') return PhotonConstants.VALUE_TYPE.STRING;
        if (typeof v === 'boolean') return PhotonConstants.VALUE_TYPE.BOOLEAN;
        if (v instanceof Uint8Array) return PhotonConstants.VALUE_TYPE.BYTE_ARRAY;
        if (Array.isArray(v)) return PhotonConstants.VALUE_TYPE.ARRAY;
        if (v instanceof Map) return PhotonConstants.VALUE_TYPE.HASH_TABLE;
        return PhotonConstants.VALUE_TYPE.NULL;
    }
}

class PhotonPacket {
    constructor(buffer) { this.reader = new PhotonReader(buffer); this.parse(); }

    static fromBase64(str) { return new PhotonPacket(Uint8Array.from(atob(str), c => c.charCodeAt(0)).buffer); }

    parse() {
        this.magic = this.reader.readUint8();
        switch (this.magic) {
            case PhotonConstants.MAGIC.GP_BINARY_V2: this.parseBinary(); break;
            case PhotonConstants.MAGIC.PING: this.serverTime = this.reader.readUint32(); this.clientTime = this.reader.readUint32(); break;
            default: console.warn(`Unsupported magic: ${this.magic}`); break;
        }
    }

    parseBinary() {
        let type = this.reader.readUint8(); this.encrypted = (type & 0x80) !== 0; type &= 0x7F; this.type = type;
        switch (type) {
            case PhotonConstants.TYPE.REQUEST: case PhotonConstants.TYPE.MESSAGE:
                this.operationCode = this.reader.readUint8(); this.parameters = this.readParams(); break;
            case PhotonConstants.TYPE.RESPONSE: case PhotonConstants.TYPE.MESSAGE_RETURN:
                this.returnCode = this.reader.readUint16(); this.debugMessage = this.reader.readValue(); this.parameters = this.readParams(); break;
            case PhotonConstants.TYPE.EVENT:
                this.eventCode = this.reader.readUint8(); this.parameters = this.readParams(); break;
            default: this.relay = true; break;
        }
    }

    readParams() { return this.reader.readTypedArray(this.reader.readUint16, () => [this.reader.readUint8(), this.reader.readValue()]); }

    serialize() {
        const w = new PhotonWriter();
        w.writeUint8(this.magic);
        if (this.magic === PhotonConstants.MAGIC.GP_BINARY_V2) {
            w.writeUint8(this.type | (this.encrypted ? 0x80 : 0));
            if (this.operationCode !== undefined) w.writeUint8(this.operationCode);
            if (this.returnCode !== undefined) w.writeUint16(this.returnCode).writeValue(this.debugMessage);
            if (this.eventCode !== undefined) w.writeUint8(this.eventCode);
            if (this.parameters) w.writeUint16(this.parameters.length).writeBytes(this.parameters.flatMap(([c, v]) => [c, ...new PhotonWriter().writeValue(v).getBuffer()]));
        } else if (this.magic === PhotonConstants.MAGIC.PING) {
            w.writeUint32(this.serverTime).writeUint32(this.clientTime);
        }
        return w.getBuffer();
    }

    toBase64() { return btoa(String.fromCharCode(...new Uint8Array(this.serialize()))); }
}

class PhotonPacketFactory {
    static create(type, code, params = [], encrypted = false) {
        const packet = { magic: PhotonConstants.MAGIC.GP_BINARY_V2, type, parameters: params, encrypted };
        if (type === PhotonConstants.TYPE.REQUEST || type === PhotonConstants.TYPE.MESSAGE) packet.operationCode = code;
        if (type === PhotonConstants.TYPE.EVENT) packet.eventCode = code;
        packet.addParameter = (c, v) => (packet.parameters.push([c, v]), packet);
        packet.serialize = () => new PhotonPacketFactory().serialize(packet);
        packet.toBase64 = () => btoa(String.fromCharCode(...new Uint8Array(packet.serialize())));
        return packet;
    }

    static createRequest(code, params, encrypted) { return this.create(PhotonConstants.TYPE.REQUEST, code, params, encrypted); }
    static createEvent(code, params, encrypted) { return this.create(PhotonConstants.TYPE.EVENT, code, params, encrypted); }

    serialize(packet) {
        const w = new PhotonWriter();
        w.writeUint8(packet.magic).writeUint8(packet.type | (packet.encrypted ? 0x80 : 0));
        if (packet.operationCode !== undefined) w.writeUint8(packet.operationCode);
        if (packet.eventCode !== undefined) w.writeUint8(packet.eventCode);
        w.writeUint16(packet.parameters.length);
        for (const [c, v] of packet.parameters) w.writeUint8(c).writeValue(v);
        return w.getBuffer();
    }
}