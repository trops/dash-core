const OpenAI = require("openai");
const events = require("../events");

const openaiController = {
    async describeImage(
        win,
        imageUrl,
        apiKey,
        prompt = "What's in this image?"
    ) {
        try {
            const openai = new OpenAI({
                apiKey: apiKey,
            });
            const response = await openai.chat.completions.create({
                model: "gpt-4-vision-preview",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            {
                                type: "image_url",
                                image_url: imageUrl,
                            },
                        ],
                    },
                ],
            });

            win.webContents.send(events.OPENAI_DESCRIBE_IMAGE_COMPLETE, {
                succes: true,
                imageUrl,
                response,
            });
        } catch (e) {
            win.webContents.send(events.OPENAI_DESCRIBE_IMAGE_ERROR, {
                succes: true,
                error: e.message,
            });
        }
    },
};

module.exports = openaiController;
