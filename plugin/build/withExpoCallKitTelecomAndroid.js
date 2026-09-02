"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withExpoCallKitTelecomAndroid = void 0;
const config_plugins_1 = require("expo/config-plugins");
const fs_1 = require("fs");
const path_1 = require("path");
const constants_1 = require("./constants");
const ERROR_MSG_PREFIX = "An error occurred while configuring Android calls. ";
// biome-ignore lint/suspicious/noExplicitAny: Expo config plugin manifest types are untyped
function setMetaDataValue(app, key, value) {
    const existing = app["meta-data"]?.find(
    // biome-ignore lint/suspicious/noExplicitAny: manifest meta-data items are untyped
    (item) => item.$["android:name"] === key);
    if (existing) {
        existing.$["android:value"] = value;
        return;
    }
    if (!app["meta-data"]) {
        app["meta-data"] = [];
    }
    app["meta-data"].push({
        $: {
            "android:name": key,
            "android:value": value,
        },
    });
}
/**
 * Sanitizes a filename for use as an Android raw resource name.
 *
 * Android raw resource names must be lowercase, alphanumeric + underscores,
 * and cannot start with a digit.
 */
function toAndroidRawResourceName(filename) {
    const withoutExtension = filename.replace(/\.[^.]+$/, "");
    const sanitized = withoutExtension.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    return /^\d/.test(sanitized) ? `_${sanitized}` : sanitized;
}
/**
 * Configures call timeout values in AndroidManifest metadata.
 */
const withTimeouts = (config, { incomingCallTimeout, outgoingCallTimeout, fulfillAnswerCallTimeout, fulfillEndCallTimeout, }) => {
    return (0, config_plugins_1.withAndroidManifest)(config, (config) => {
        const app = config_plugins_1.AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
        setMetaDataValue(app, "ExpoCallKitTelecomIncomingCallTimeout", String(incomingCallTimeout ?? constants_1.DEFAULT_INCOMING_CALL_TIMEOUT));
        setMetaDataValue(app, "ExpoCallKitTelecomOutgoingCallTimeout", String(outgoingCallTimeout ?? constants_1.DEFAULT_OUTGOING_CALL_TIMEOUT));
        setMetaDataValue(app, "ExpoCallKitTelecomFulfillAnswerCallTimeout", String(fulfillAnswerCallTimeout ?? constants_1.DEFAULT_FULFILL_ANSWER_CALL_TIMEOUT));
        setMetaDataValue(app, "ExpoCallKitTelecomFulfillEndCallTimeout", String(fulfillEndCallTimeout ?? constants_1.DEFAULT_FULFILL_END_CALL_TIMEOUT));
        return config;
    });
};
/**
 * Copies sound files into the Android raw resources directory.
 */
const withSounds = (config, { sounds }) => {
    if (!sounds || sounds.length === 0) {
        return config;
    }
    return (0, config_plugins_1.withDangerousMod)(config, [
        "android",
        (config) => {
            const projectRoot = config.modRequest.projectRoot;
            const rawDir = (0, path_1.resolve)(projectRoot, "android", "app", "src", "main", "res", "raw");
            (0, fs_1.mkdirSync)(rawDir, { recursive: true });
            for (const soundPath of sounds) {
                const filename = (0, path_1.basename)(soundPath);
                const sourcePath = (0, path_1.resolve)(projectRoot, soundPath);
                if (!(0, fs_1.existsSync)(sourcePath)) {
                    throw new Error(`${ERROR_MSG_PREFIX}Sound file not found: ${sourcePath}`);
                }
                const resourceName = toAndroidRawResourceName(filename);
                const extension = filename.includes(".")
                    ? filename.substring(filename.lastIndexOf("."))
                    : "";
                const destinationPath = (0, path_1.resolve)(rawDir, `${resourceName}${extension}`);
                (0, fs_1.copyFileSync)(sourcePath, destinationPath);
            }
            return config;
        },
    ]);
};
/**
 * Configures the default dialtone for outgoing calls in AndroidManifest metadata.
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
    return (0, config_plugins_1.withAndroidManifest)(config, (config) => {
        const app = config_plugins_1.AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
        setMetaDataValue(app, "ExpoCallKitTelecomDefaultDialtone", toAndroidRawResourceName(defaultDialtone));
        return config;
    });
};
/**
 * Configures the default ringtone for incoming calls in AndroidManifest metadata.
 *
 * Mirrors the iOS `withDefaultRingtone` plugin. The Kotlin side reads
 * `ExpoCallKitTelecomDefaultRingtone` from manifest metadata and sets it as the
 * notification channel sound.
 */
const withDefaultRingtone = (config, { sounds, defaultRingtone }) => {
    if (!defaultRingtone || defaultRingtone === "default") {
        return config;
    }
    const soundFilenames = sounds?.map((s) => (0, path_1.basename)(s)) ?? [];
    if (soundFilenames.length === 0) {
        throw new Error(`${ERROR_MSG_PREFIX}"defaultRingtone" was specified but no ` +
            `sounds were provided.`);
    }
    if (!soundFilenames.includes(defaultRingtone)) {
        throw new Error(`${ERROR_MSG_PREFIX}"defaultRingtone" must be one of the provided ` +
            `sounds (${soundFilenames.join(", ")}) or "default" for ` +
            `system ringtone.`);
    }
    return (0, config_plugins_1.withAndroidManifest)(config, (config) => {
        const app = config_plugins_1.AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
        setMetaDataValue(app, "ExpoCallKitTelecomDefaultRingtone", toAndroidRawResourceName(defaultRingtone));
        return config;
    });
};
/**
 * Removes expo-notifications' ExpoFirebaseMessagingService from the manifest.
 *
 * Our ExpoCallKitTelecomMessagingService extends it and takes over as the sole
 * MESSAGING_EVENT handler, delegating non-call messages via super.
 * Having both services registered would cause undefined delivery behaviour.
 *
 * The service is declared in expo-notifications' library AndroidManifest.xml,
 * so we must use `tools:node="remove"` to tell the manifest merger to strip it.
 */
const withFirebaseMessagingService = (config) => {
    return (0, config_plugins_1.withAndroidManifest)(config, (config) => {
        const manifest = config.modResults.manifest;
        // Ensure the tools namespace is declared on the root <manifest> element.
        if (!manifest.$["xmlns:tools"]) {
            manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
        }
        const app = config_plugins_1.AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
        if (!app.service) {
            app.service = [];
        }
        const notificationsService = "expo.modules.notifications.service.ExpoFirebaseMessagingService";
        // Remove any existing entry first (idempotent across repeated prebuilds).
        app.service = app.service.filter((service) => service.$?.["android:name"] !== notificationsService);
        // Add a tools:node="remove" marker so the manifest merger strips the
        // library-declared service during the Gradle build.
        const removeEntry = {
            $: {
                "android:name": notificationsService,
                "tools:node": "remove",
            },
        };
        app.service.push(removeEntry);
        return config;
    });
};
/**
 * Registers a manifest BroadcastReceiver for the module's call-event broadcast.
 *
 * Fired when a call event can't reach a live JS observer (e.g. a killed-app
 * decline). The receiver entry uses {@link ANDROID_CALL_EVENT_ACTION}. The app
 * supplies the receiver class itself (the plugin does not generate it).
 */
const withEventReceiver = (config, { androidEventReceiver }) => {
    if (!androidEventReceiver) {
        return config;
    }
    return (0, config_plugins_1.withAndroidManifest)(config, (config) => {
        const app = config_plugins_1.AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
        // Remove any existing entry first (idempotent across repeated prebuilds).
        app.receiver = (app.receiver ?? []).filter((receiver) => receiver.$["android:name"] !== androidEventReceiver);
        app.receiver.push({
            $: {
                "android:name": androidEventReceiver,
                "android:exported": "false",
            },
            "intent-filter": [
                {
                    action: [{ $: { "android:name": constants_1.ANDROID_CALL_EVENT_ACTION } }],
                },
            ],
        });
        return config;
    });
};
const withExpoCallKitTelecomAndroid = (config, props) => {
    config = withTimeouts(config, props);
    config = withSounds(config, props);
    config = withDefaultRingtone(config, {
        sounds: props.sounds,
        defaultRingtone: props.defaultRingtoneAndroid,
    });
    config = withDefaultDialtone(config, props);
    config = withFirebaseMessagingService(config, props);
    config = withEventReceiver(config, props);
    return config;
};
exports.withExpoCallKitTelecomAndroid = withExpoCallKitTelecomAndroid;
