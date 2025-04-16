const crypto = require('crypto');
const fetch = require("node-fetch");

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

module.exports = Account;
