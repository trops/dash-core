/**
 * Event Constants — Registry Auth Events
 *
 * IPC event constants for registry authentication (device code flow).
 */
const REGISTRY_AUTH_INITIATE_LOGIN = "registry-auth:initiate-login";
const REGISTRY_AUTH_POLL_TOKEN = "registry-auth:poll-token";
const REGISTRY_AUTH_GET_STATUS = "registry-auth:get-status";
const REGISTRY_AUTH_GET_PROFILE = "registry-auth:get-profile";
const REGISTRY_AUTH_LOGOUT = "registry-auth:logout";
const REGISTRY_AUTH_PUBLISH = "registry-auth:publish";

module.exports = {
    REGISTRY_AUTH_INITIATE_LOGIN,
    REGISTRY_AUTH_POLL_TOKEN,
    REGISTRY_AUTH_GET_STATUS,
    REGISTRY_AUTH_GET_PROFILE,
    REGISTRY_AUTH_LOGOUT,
    REGISTRY_AUTH_PUBLISH,
};
