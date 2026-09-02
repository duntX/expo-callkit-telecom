"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANDROID_CALL_EVENT_ACTION = exports.DEFAULT_FULFILL_END_CALL_TIMEOUT = exports.DEFAULT_FULFILL_ANSWER_CALL_TIMEOUT = exports.DEFAULT_OUTGOING_CALL_TIMEOUT = exports.DEFAULT_INCOMING_CALL_TIMEOUT = void 0;
// Default timeout values in seconds
exports.DEFAULT_INCOMING_CALL_TIMEOUT = 45;
exports.DEFAULT_OUTGOING_CALL_TIMEOUT = 60;
exports.DEFAULT_FULFILL_ANSWER_CALL_TIMEOUT = 30;
exports.DEFAULT_FULFILL_END_CALL_TIMEOUT = 5;
/**
 * Action for the package-internal call-event broadcast (Android). The
 * `androidEventReceiver` plugin prop registers the manifest receiver for it.
 */
exports.ANDROID_CALL_EVENT_ACTION = "expo.modules.callkittelecom.ACTION_CALL_EVENT";
