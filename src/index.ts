import fs from "fs"
import express, { Express, Request, Response } from "express";
import * as line from '@line/bot-sdk'
import { authenticator } from "otplib"

interface ConfigJson {
    userIds: string[];
    groupIds: string[];
    botOwner: {
        name: string;
        id: string;
    };
}

const configJson: ConfigJson = require("../config.json");

const app: Express = express()
const port = 3000
require('dotenv').config()

const otpSecret = process.env.OTP_SECRET!

const config = {
    channelSecret: process.env.CHANNEL_SECRET!
};

const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: process.env.ACCESS_TOKEN!
});

const cooldowns: { [userId: string]: number } = {};
const cooldownDuration = 60 * 60 * 1000; // 1 hour

const cleanUpCooldowns = () => {
    const now = Date.now();
    for (const userId in cooldowns) {
        if (now - cooldowns[userId] > cooldownDuration) {
            delete cooldowns[userId];
        }
    }
};

app.post('/webhook', line.middleware(config), (req: Request, res: Response) => {
    Promise.all([
        req.body.events.map(handleEvent)
    ])
    .then((result) => res.json(result))
})

const replyOtp = (replyToken) => {
    const token = authenticator.generate(otpSecret)
    try {
        const isValid = authenticator.check(token, otpSecret);
        return client.replyMessage({
            replyToken: replyToken,
            messages: [
                {
                    "type": "text",
                    "text": token
                }
            ]
        })
    } catch (err) {
        console.error(err);
    }
}

const handleEvent = (event) => {
    // console.log(event)
    if (event.type === "message") {
        if (event.source.userId === configJson.botOwner.id && event.message.text.startsWith('allow user') && event.source.type === "user") {
            const userId: string = event.message.text.split(' ').at(-1);
            let response: Promise<line.messagingApi.ReplyMessageResponse> | null = null;
            client.getProfile(userId)
            .then((profile) => {
                const userId: string = event.source.userId;
                if (!configJson.userIds.includes(userId)) {
                    configJson.userIds.push(userId);

                    fs.writeFileSync("./config.json", JSON.stringify(configJson, null, 4));

                    response = client.replyMessage({
                        replyToken: event.replyToken,
                        messages: [
                            {
                                "type": "text",
                                "text": "This user has been verified."
                            }
                        ]
                    });
                } else {
                    response = client.replyMessage({
                        replyToken: event.replyToken,
                        messages: [
                            {
                                "type": "text",
                                "text": "This user is already allowed."
                            }
                        ]
                    });
                }
            })
            .catch(() => {
                response = client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [
                        {
                            "type": "text",
                            "text": "Invalid user ID"
                        }
                    ]
                });
            })
            return response;
        } else if (event.source.userId === configJson.botOwner.id && event.message.text.startsWith('disallow user') && event.source.type === "user") {
            const userId: string = event.message.text.split(' ').at(-1);
            const index = configJson.userIds.indexOf(userId)                    
            if (index > -1) {
                configJson.userIds.splice(index, 1)

                fs.writeFileSync("./config.json", JSON.stringify(configJson, null, 4));

                return client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [
                        {
                            "type": "text",
                            "text": "This user has been disallowed."
                        }
                    ]
                });
            } else {
                return client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [
                        {
                            "type": "text",
                            "text": "This user isn't already allowed."
                        }
                    ]
                });
            }
        }

        if (configJson.userIds.includes(event.source.userId)) {
            if (event.source.type === "user") {
                replyOtp(event.replyToken);
            } else if (event.source.type === "group") {
                if (event.message.text === "lambda allow group") {
                    const groupId: string = event.source.groupId;
                    if (!configJson.groupIds.includes(groupId)) {
                        configJson.groupIds.push(groupId);

                        fs.writeFileSync("./config.json", JSON.stringify(configJson, null, 4));

                        return client.replyMessage({
                            replyToken: event.replyToken,
                            messages: [
                                {
                                    "type": "text",
                                    "text": "This group has been allowed."
                                }
                            ]
                        });
                    } else {
                        return client.replyMessage({
                            replyToken: event.replyToken,
                            messages: [
                                {
                                    "type": "text",
                                    "text": "This group is already allowed."
                                }
                            ]
                        });
                    }
                } else if (event.message.text === "lambda disallow group") {
                    const groupId: string = event.source.groupId;
                    const index = configJson.groupIds.indexOf(groupId)
                    
                    if (index > -1) {
                        configJson.groupIds.splice(index, 1)
                        fs.writeFileSync("./config.json", JSON.stringify(configJson, null, 4));

                        return client.replyMessage({
                            replyToken: event.replyToken,
                            messages: [
                                {
                                    "type": "text",
                                    "text": "This group has been disallowed."
                                }
                            ]
                        });
                    } else {
                        return client.replyMessage({
                            replyToken: event.replyToken,
                            messages: [
                                {
                                    "type": "text",
                                    "text": "This group isn't already allowed."
                                }
                            ]
                        });
                    }
                }
            }
        } else if (event.source.type === "user") {
            const userId = event.source.userId;
            if (event.message.text === "allow me") {
                const now = Date.now();
                const lastRequestTime = cooldowns[userId] || 0;

                if (now - lastRequestTime < cooldownDuration) {
                    const remainingTime = Math.ceil((cooldownDuration - (now - lastRequestTime)) / 1000 / 60); // Time in minutes
                    return client.replyMessage({
                        replyToken: event.replyToken,
                        messages: [
                            {
                                "type": "text",
                                "text": `You must wait ${remainingTime} more minutes before requesting verification again.`
                            }
                        ]
                    });
                } else {
                    cooldowns[userId] = now;
                    client.getProfile(userId)
                    .then((profile) => {
                        client.pushMessage({
                            to: configJson.botOwner.id,
                            messages: [
                                {
                                    "type": "text",
                                    "text": `Allow? Name: ${profile.displayName} ID: ${userId}`
                                }
                            ]
                        })
                    })
                    return client.replyMessage({
                        replyToken: event.replyToken,
                        messages: [
                            {
                                "type": "text",
                                "text": `Requested for ${configJson.botOwner.name}'s verification`
                            }
                        ]
                    });
                }
            } else {
                return client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [
                        {
                            "type": "text",
                            "text": `You have not been verified, type "allow me" here and ${configJson.botOwner.name} will be able to verify you`
                        }
                    ]
                })
            }
        }
        if (event.message.text === "lambda otp" && event.source.type === "group") {
            if (configJson.groupIds.includes(event.source.groupId)) {
                replyOtp(event.replyToken);
            } else {
                return client.replyMessage({
                    replyToken: event.replyToken,
                    messages: [
                        {
                            "type": "text",
                            "text": "This group isn't allowed to use lambda otp."
                        }
                    ]
                });
            }
        }
    }
    return Promise.resolve(null);
}

app.get('/', (req: Request, res: Response) => {
    res.send("ok")
})


setInterval(cleanUpCooldowns, 5 * 60 * 1000);
app.listen(port, () => console.log(`Start server on port ${port}`))