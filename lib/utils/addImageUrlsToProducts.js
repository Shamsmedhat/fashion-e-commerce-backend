// Add these helper functions after your imports
const getImageUrl = (req, filename) => {
  if (!filename) return null;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}/img/products/${filename}`;
};

const addImageUrlsToProduct = (req, product) => {
  const productObj = product.toObject ? product.toObject() : product;

  return {
    ...productObj,
    coverImage: getImageUrl(req, productObj.coverImage),
    images: productObj.images ? productObj.images.map((img) => getImageUrl(req, img)) : [],
  };
};

module.exports = addImageUrlsToProduct;
