"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withExpoCallKitTelecomIos = void 0;
const config_plugins_1 = require("expo/config-plugins");
const fs_1 = require("fs");
const path_1 = require("path");
const constants_1 = require("./constants");
const ERROR_MSG_PREFIX = "An error occurred while configuring iOS calls. ";
// Default permission messages
const CAMERA_USAGE = "Allow $(PRODUCT_NAME) to access your camera";
const MICROPHONE_USAGE = "Allow $(PRODUCT_NAME) to access your microphone";
// Required background modes for CallKit and PushKit:
// - voip: Receive VoIP push notifications to wake the app for incoming calls
// - audio: Continue audio playback/recording during calls when app is backgrounded
const BACKGROUND_MODES = ["voip", "audio"];
// SiriKit intents for voice-activated calls
// INStartCallIntent: Unified intent for iOS 13+ (recommended)
// INStartAudioCallIntent/INStartVideoCallIntent: Deprecated in iOS 13, but still
// sent by the system in some cases (e.g., redialing from call history)
const SIRI_INTENTS = [
    "INStartCallIntent",
    "INStartAudioCallIntent",
    "INStartVideoCallIntent",
];
/**
 * Configures camera and microphone permissions for VoIP and video calls.
 */
const withPermissions = (config, { cameraPermission, microphonePermission }) => {
    return config_plugins_1.IOSConfig.Permissions.createPermissionsPlugin({
        NSCameraUsageDescription: CAMERA_USAGE,
        NSMicrophoneUsageDescription: MICROPHONE_USAGE,
    })(config, {
        NSCameraUsageDescription: cameraPermission,
        NSMicrophoneUsageDescription: microphonePermission,
    });
};
/**
 * Configures push notification entitlement for PushKit VoIP notifications.
 */
const withPushNotificationEntitlement = (config) => {
    return (0, config_plugins_1.withEntitlementsPlist)(config, (config) => {
        const key = "aps-environment";
        // Only set if not already configured; production builds use provisioning profile value
        if (!config.modResults[key]) {
            config.modResults[key] = "development";
        }
        return config;
    });
};
/**
 * Configures UIBackgroundModes for VoIP call handling.
 */
const withBackgroundModes = (config) => {
    return (0, config_plugins_1.withInfoPlist)(config, (config) => {
        const existingModes = config.modResults.UIBackgroundModes;
        const modes = Array.isArray(existingModes)
            ? existingModes
            : [];
        const newModes = new Set([...modes, ...BACKGROUND_MODES]);
        config.modResults.UIBackgroundModes = [...newModes];
        return config;
    });
};
/**
 * Configures SiriKit intents for voice-activated audio/video calls.
 */
const withSiriIntents = (config) => {
    return (0, config_plugins_1.withInfoPlist)(config, (config) => {
        const existingIntents = config.modResults.NSUserActivityTypes;
        const intents = Array.isArray(existingIntents)
            ? existingIntents
            : [];
        const newIntents = new Set([...intents, ...SIRI_INTENTS]);
        config.modResults.NSUserActivityTypes = [...newIntents];
        return config;
    });
};
/**
 * Configures call timeout values in Info.plist.
 */
const withTimeouts = (config, { incomingCallTimeout, outgoingCallTimeout, fulfillAnswerCallTimeout, fulfillEndCallTimeout, }) => {
    return (0, config_plugins_1.withInfoPlist)(config, (config) => {
        config.modResults.ExpoCallKitTelecomIncomingCallTimeout =
            incomingCallTimeout ?? constants_1.DEFAULT_INCOMING_CALL_TIMEOUT;
        config.modResults.ExpoCallKitTelecomOutgoingCallTimeout =
            outgoingCallTimeout ?? constants_1.DEFAULT_OUTGOING_CALL_TIMEOUT;
        config.modResults.ExpoCallKitTelecomFulfillAnswerCallTimeout =
            fulfillAnswerCallTimeout ?? constants_1.DEFAULT_FULFILL_ANSWER_CALL_TIMEOUT;
        config.modResults.ExpoCallKitTelecomFulfillEndCallTimeout =
            fulfillEndCallTimeout ?? constants_1.DEFAULT_FULFILL_END_CALL_TIMEOUT;
        return config;
    });
};
/**
 * Copies sound files into the iOS project bundle.
 */
function setSoundFiles(config, sounds) {
    const projectRoot = config.modRequest.projectRoot;
    const projectName = config.modRequest.projectName;
    if (!projectName) {
        throw new Error(`${ERROR_MSG_PREFIX}Unable to find iOS project name.`);
    }
    const sourceRoot = (0, path_1.resolve)(projectRoot, "ios", projectName);
    for (const soundPath of sounds) {
        const filename = (0, path_1.basename)(soundPath);
        const sourcePath = (0, path_1.resolve)(projectRoot, soundPath);
        const destinationPath = (0, path_1.resolve)(sourceRoot, filename);
        if (!(0, fs_1.existsSync)(sourcePath)) {
            throw new Error(`${ERROR_MSG_PREFIX}Sound file not found: ${sourcePath}`);
        }
        // Copy the file to the iOS project directory
        (0, fs_1.copyFileSync)(sourcePath, destinationPath);
        // Add the file to the Xcode project if not already present
        if (!config.modResults.hasFile(`${projectName}/${filename}`)) {
            config.modResults = config_plugins_1.IOSConfig.XcodeUtils.addResourceFileToGroup({
                filepath: `${projectName}/${filename}`,
                groupName: projectName,
                isBuildFile: true,
                project: config.modResults,
            });
        }
    }
    return config;
}
/**
 * Copies sound files into the iOS project bundle.
 */
const withSounds = (config, { sounds }) => {
    if (sounds && sounds.length > 0) {
        config = (0, config_plugins_1.withXcodeProject)(config, (config) => {
            return setSoundFiles(config, sounds);
        });
    }
    return config;
};
/**
 * Configures the default ringtone for incoming calls in Info.plist.
 */
const withDefaultRingtone = (config, { sounds, defaultRingtone }) => {
    const soundFilenames = sounds?.map((s) => (0, path_1.basename)(s)) ?? [];
    // Validate defaultRingtone if specified and not 'default'
    if (defaultRingtone && defaultRingtone !== "default") {
        if (soundFilenames.length === 0) {
            throw new Error(`${ERROR_MSG_PREFIX}"defaultRingtone" was specified but no ` +
                `sounds were provided.`);
        }
        if (!soundFilenames.includes(defaultRingtone)) {
            throw new Error(`${ERROR_MSG_PREFIX}"defaultRingtone" must be one of the provided ` +
                `sounds (${soundFilenames.join(", ")}) or "default" for ` +
                `system ringtone.`);
        }
    }
    return (0, config_plugins_1.withInfoPlist)(config, (config) => {
        config.modResults.ExpoCallKitTelecomDefaultRingtone = defaultRingtone || "default";
        return config;
    });
};
/**
 * Configures the default dialtone for outgoing calls in Info.plist.
 */
const withDefaultDialtone = (config, { sounds, defaultDialtone }) => {
    if (!defaultDialtone) {
        return config;
    }
    const soundFilenames = sounds?.map((s) => (0, path_1.basename)(s)) ?? [];
    if (soundFilenames.length === 0) {
        throw new Error(`${ERROR_MSG_PREFIX}"defaultDialtone" was specified but no ` +
            `sounds were provided.`);
    }
    if (!soundFilenames.includes(defaultDialtone)) {
        throw new Error(`${ERROR_MSG_PREFIX}"defaultDialtone" must be one of the provided ` +
            `sounds (${soundFilenames.join(", ")}).`);
    }
    return (0, config_plugins_1.withInfoPlist)(config, (config) => {
        config.modResults.ExpoCallKitTelecomDefaultDialtone = defaultDialtone;
        return config;
    });
};
const withExpoCallKitTelecomIos = (config, { cameraPermission, microphonePermission, incomingCallTimeout, outgoingCallTimeout, fulfillAnswerCallTimeout, fulfillEndCallTimeout, sounds, defaultRingtoneIos, defaultDialtone, }) => {
    config = withPermissions(config, { cameraPermission, microphonePermission });
    config = withPushNotificationEntitlement(config);
    config = withBackgroundModes(config);
    config = withSiriIntents(config);
    config = withTimeouts(config, {
        incomingCallTimeout,
        outgoingCallTimeout,
        fulfillAnswerCallTimeout,
        fulfillEndCallTimeout,
    });
    config = withSounds(config, { sounds });
    config = withDefaultRingtone(config, {
        sounds,
        defaultRingtone: defaultRingtoneIos,
    });
    config = withDefaultDialtone(config, { sounds, defaultDialtone });
    return config;
};
exports.withExpoCallKitTelecomIos = withExpoCallKitTelecomIos;
