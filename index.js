const express = require("express");
const axios = require("axios");
require("dotenv").config();

const fs = require("fs");
const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const path = require("path");

// const { postAchievement } = require("./post");

const app = express();

const {
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  REDIRECT_URI,
  AWS_S3_BADGE_IMAGES_BUCKET,
} = process.env;

const ACCESS_TOKEN =
  "AQXOGhTVxTIXiGYIZlV_UzKR1GYTr14opvgUxGgdalfQukZXT9XjkPEYOd9u2Sd23vlLCUh-8HLULGCrdEos92HAVbaPhVJX-QG3Pz82aUptL_9J2sX460OVLvu9g8E1SQz0fpKD2NKmgoRN_wNw_x9sfwCXNeVdh18fuPXiSZGJNaFaaguUjazaE-03aYJJZsHtHl9gOWuF24VGNhXcSnCQ4LUiAHHDelGDzzklv4kE8yQTpohy2HDT-Xy0zW7Zyw5gKU3OkQnldX7_WlyI3i_XKJvAYFqn236Rmh4ZvgncDSW6v0KpM5Gr9dcPQw-CKXDg-YCyy3iRj-c56dbS7w8Bk7zVaA";

console.log(
  "LINKEDIN_CLIENT_ID:",
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  REDIRECT_URI
);

// Step 1: Redirect user to LinkedIn auth URL
app.get("/auth", (req, res) => {
  const scope = "profile email w_member_social openid";
  const state = "random_string_123";

  const authUrl =
    `https://www.linkedin.com/oauth/v2/authorization` +
    `?response_type=code` +
    `&client_id=${encodeURIComponent(LINKEDIN_CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(state)}`;

  console.log("Redirecting to:", authUrl);
  res.redirect(authUrl); // Redirect user to LinkedIn's consent screen
});

// Step 2: Handle LinkedIn callback and exchange code for access token
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;

  if (!code) {
    return res.send("Missing authorization code.");
  }

  try {
    // Exchange auth code for access token
    const tokenRes = await axios.post(
      "https://www.linkedin.com/oauth/v2/accessToken",
      null,
      {
        params: {
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: LINKEDIN_CLIENT_ID,
          client_secret: LINKEDIN_CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    let accessToken = tokenRes.data.access_token;
    const expiresIn = tokenRes.data.expires_in;
    const tokenCreatedAt = Date.now();
    console.log("Access Token:", tokenRes.data, "\n", expiresIn, "\n", tokenCreatedAt);

    res.send(`
        ✅ Access Token: ${accessToken}<br><br>${tokenCreatedAt} <br><br>
        You can now use this token to post achievements or fetch profile.<br>
        Keep it secure.
      `);
  } catch (err) {
    console.error("---> error", err.response?.data || err.message);
    res.send("❌ Error retrieving access token.");
  }
});

// Step 3: Use access token to post achievement
app.post("/post-linkedIn", express.json(), async (req, res) => {
  const imageBuffer = await s3
    .getObject({
      Bucket: AWS_S3_BADGE_IMAGES_BUCKET,
      Key: "tuLe_KKITqexzZ5ukxBZ3g.png",
    })
    .promise()
    .then((data) => data.Body)
    .catch((err) => {
      console.error("Error fetching image from S3:", err);
      const imagePath = path.join(__dirname, "image/test-img.webp");
      const imageData = fs.readFileSync(imagePath);
      return imageData;
    });

  try {
    // 1. Get user URN
    const profileRes = await axios.get("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });

    const urn = `urn:li:person:${profileRes.data.sub}`;
    console.log("User URN:", profileRes.data);

    // 2. Register upload
    const registerRes = await axios.post(
      "https://api.linkedin.com/v2/assets?action=registerUpload",
      {
        registerUploadRequest: {
          owner: urn,
          recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
          serviceRelationships: [
            {
              relationshipType: "OWNER",
              identifier: "urn:li:userGeneratedContent",
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const uploadUrl =
      registerRes.data.value.uploadMechanism[
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
      ].uploadUrl;
    const asset = registerRes.data.value.asset;
    console.log("Upload URL:", uploadUrl);
    console.log("Asset URN:", asset);

    // 3. Upload image
    const imagePath = path.join(__dirname, "image/test-img.webp");
    const imageData = fs.readFileSync(imagePath);

    await axios.put(uploadUrl, imageBuffer, {
      headers: {
        "Content-Type": "image/jpeg",
      },
    });
    console.log("Image uploaded");

    // 4. Create UGC post with image
    const message = `API TEST ----> 🚀 image upload from S3 ${new Date().toISOString()}`;
    const postBody = {
      author: urn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: {
            text: message,
          },
          shareMediaCategory: "IMAGE",
          media: [
            {
              status: "READY",
              media: asset,
            },
          ],
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
      },
    };

    const postRes = await axios.post(
      "https://api.linkedin.com/v2/ugcPosts",
      postBody,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      }
    );

    console.log("Post created:", postRes.data);
    res.send("Image post published to LinkedIn!");
  } catch (err) {
    console.error("Post error:", err.response?.data || err.message);
    res.status(500).send("Failed to post image to LinkedIn.");
  }
});

app.get("/", (req, res) => {
  res.send("hello world");
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
