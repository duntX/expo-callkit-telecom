"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_plugins_1 = require("expo/config-plugins");
const package_json_1 = __importDefault(require("../../package.json"));
const withExpoCallKitTelecomAndroid_1 = require("./withExpoCallKitTelecomAndroid");
const withExpoCallKitTelecomIos_1 = require("./withExpoCallKitTelecomIos");
const withExpoCallKitTelecom = (config, props) => {
    const opts = props ?? {};
    config = (0, withExpoCallKitTelecomAndroid_1.withExpoCallKitTelecomAndroid)(config, opts);
    config = (0, withExpoCallKitTelecomIos_1.withExpoCallKitTelecomIos)(config, opts);
    return config;
};
exports.default = (0, config_plugins_1.createRunOncePlugin)(withExpoCallKitTelecom, package_json_1.default.name, package_json_1.default.version);
