const path = require("path");
const { app } = require("electron");

const events = require("../events");
const lpm = require("live-plugin-manager");
const { PluginManager } = require("live-plugin-manager");

const pluginController = {
    install: (win, packageName, filepath) => {
        try {
            const rootPath = path.join(
                app.getPath("userData"),
                "plugins",
                packageName
            );
        } catch (e) {
            win.webContents.send("plugin-install-error", { error: e.message });
        }
    },
};

module.exports = pluginController;
