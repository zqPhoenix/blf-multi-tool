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

module.exports = PacketScanner;
  