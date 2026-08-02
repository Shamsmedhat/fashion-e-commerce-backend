# fashion-e-commerce

## Product image uploads

Product images upload directly from the authenticated admin browser to Cloudinary. Image bytes must
not be sent to this API.

1. Request `GET /api/v1/products/upload-signature` with the same admin authentication used to
   create products. The response contains `timestamp`, `folder`, `signature`, `cloudName`, and
   `apiKey`.
2. Send each image as multipart form data directly to
   `https://api.cloudinary.com/v1_1/<cloudName>/image/upload`, including the returned `timestamp`,
   `folder`, `signature`, and `api_key`.
3. Send the Cloudinary `secure_url` values to this API as JSON in `coverImage`, `images`, and any
   variant `images`. The API accepts only URLs from its configured Cloudinary account and returns
   the same product JSON fields as before.

Stored delivery URLs apply `w_1200,h_1200,c_fill,q_90,f_jpg`. Replacing an image or deleting its
product/variant also deletes the no-longer-referenced Cloudinary asset.
