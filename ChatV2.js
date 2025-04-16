const crypto = require('crypto');
const fetch = require("node-fetch");

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

module.exports = ChatV2;
