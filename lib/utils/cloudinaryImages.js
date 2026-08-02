const cloudinary = require('cloudinary').v2;

const PRODUCT_IMAGE_FOLDER = 'products';
const PRODUCT_IMAGE_TRANSFORMATION = 'w_1200,h_1200,c_fill,q_90,f_jpg';
const PRODUCT_IMAGE_MESSAGE = 'Product images must belong to the configured Cloudinary account.';

// Field names whose values are image URLs, anywhere in the product schema.
const IMAGE_FIELD_NAMES = new Set(['coverImage', 'images']);

// Operators that remove data rather than store it; their operands are never persisted as images.
const NON_STORING_OPERATORS = new Set(['$pull', '$pullAll', '$unset', '$pop']);

// Modifiers that stay within the field they decorate, so they inherit its image context.
const VALUE_MODIFIERS = new Set(['$each', '$slice', '$position', '$sort']);

class InvalidProductImageError extends Error {
  constructor(value) {
    super(PRODUCT_IMAGE_MESSAGE);
    this.name = 'InvalidProductImageError';
    this.value = value;
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const parseCloudinaryImageUrl = (value) => {
  if (typeof value !== 'string' || !process.env.CLOUDINARY_CLOUD_NAME) return null;

  try {
    const imageUrl = new URL(value);
    if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'res.cloudinary.com') return null;

    const segments = imageUrl.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));

    const [cloudName, resourceType, deliveryType, ...deliverySegments] = segments;
    if (
      cloudName !== process.env.CLOUDINARY_CLOUD_NAME ||
      resourceType !== 'image' ||
      deliveryType !== 'upload'
    ) {
      return null;
    }

    if (deliverySegments[0] === PRODUCT_IMAGE_TRANSFORMATION) {
      deliverySegments.shift();
    } else if (/^(?:w|h|c|q|f)_/.test(deliverySegments[0] || '')) {
      return null;
    }

    if (/^v\d+$/.test(deliverySegments[0] || '')) deliverySegments.shift();
    if (
      !deliverySegments.length ||
      deliverySegments.some((segment) => !segment || segment === '..')
    ) {
      return null;
    }

    const publicId = deliverySegments.join('/').replace(/\.(?:avif|gif|jpe?g|png|webp)$/i, '');
    return publicId ? { publicId } : null;
  } catch {
    return null;
  }
};

const buildProductImageUrl = (publicId) => {
  const encodedPublicId = publicId
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `https://res.cloudinary.com/${encodeURIComponent(
    process.env.CLOUDINARY_CLOUD_NAME,
  )}/image/upload/${PRODUCT_IMAGE_TRANSFORMATION}/${encodedPublicId}.jpg`;
};

const normalizeProductImageUrl = (value) => {
  const parsedUrl = parseCloudinaryImageUrl(value);
  return parsedUrl ? buildProductImageUrl(parsedUrl.publicId) : value;
};

const isOwnedCloudinaryImageUrl = (value) => Boolean(parseCloudinaryImageUrl(value));

const getPublicIds = (urls) => {
  const publicIds = urls
    .map((imageUrl) => parseCloudinaryImageUrl(imageUrl)?.publicId)
    .filter(Boolean);

  return [...new Set(publicIds)];
};

const destroyProductImages = async (urls) => {
  const publicIds = getPublicIds(urls);

  await Promise.all(
    publicIds.map(async (publicId) => {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
        invalidate: true,
      });

      if (!['ok', 'not found'].includes(result.result)) {
        throw new Error(`Cloudinary did not delete image "${publicId}"`);
      }
    }),
  );
};

const isPlainObject = (value) =>
  typeof value === 'object' &&
  value !== null &&
  (value.constructor === Object || Object.getPrototypeOf(value) === null);

// `variants.$.images`, `images.0` and `variants.$[el].images` all target the `images` field.
const isImageFieldPath = (key) => {
  const segments = key
    .split('.')
    .filter((segment) => segment !== '$' && !/^\d+$/.test(segment) && !/^\$\[.*\]$/.test(segment));

  return IMAGE_FIELD_NAMES.has(segments[segments.length - 1]);
};

// Walks an update document of any shape and normalizes every value that will be stored in an image
// field, rejecting any URL outside our Cloudinary account. Deliberately independent of Mongoose
// update validators, which do not run reliably for positional operators.
const normalizeUpdateImageValues = (node, underImageField = false) => {
  if (typeof node === 'string') {
    if (!underImageField) return node;
    if (!isOwnedCloudinaryImageUrl(node)) throw new InvalidProductImageError(node);
    return normalizeProductImageUrl(node);
  }

  if (Array.isArray(node)) {
    return node.map((entry) => normalizeUpdateImageValues(entry, underImageField));
  }

  if (!isPlainObject(node)) return node;

  const result = {};
  Object.entries(node).forEach(([key, value]) => {
    if (NON_STORING_OPERATORS.has(key)) {
      result[key] = value;
      return;
    }

    let nextUnderImageField;
    if (VALUE_MODIFIERS.has(key)) nextUnderImageField = underImageField;
    else if (key.startsWith('$')) nextUnderImageField = false;
    else nextUnderImageField = isImageFieldPath(key);

    result[key] = normalizeUpdateImageValues(value, nextUnderImageField);
  });

  return result;
};

const createUploadSignature = () => {
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = {
    folder: PRODUCT_IMAGE_FOLDER,
    timestamp,
  };

  return {
    timestamp,
    folder: PRODUCT_IMAGE_FOLDER,
    signature: cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET),
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
  };
};

module.exports = {
  InvalidProductImageError,
  PRODUCT_IMAGE_MESSAGE,
  PRODUCT_IMAGE_TRANSFORMATION,
  createUploadSignature,
  destroyProductImages,
  getPublicIds,
  isOwnedCloudinaryImageUrl,
  normalizeProductImageUrl,
  normalizeUpdateImageValues,
};
