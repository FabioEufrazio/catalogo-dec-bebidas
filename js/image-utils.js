/* ==========================================================================
   ImageUtils
   Robust Image Compression (Canvas 400x400 JPEG), Paste Handler & Google Search
   ========================================================================== */

class ImageUtils {
  // Compress image file or data URL to max 400x400 JPEG 70% quality
  static compressImage(src, maxWidth = 400, maxHeight = 400, quality = 0.70) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';

      img.onload = () => {
        try {
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width || maxWidth;
          canvas.height = height || maxHeight;

          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          resolve(compressedBase64);
        } catch (e) {
          // Fallback if canvas is tainted by CORS
          resolve(src);
        }
      };

      img.onerror = () => {
        // Fallback to src string directly if canvas image load fails
        if (src) resolve(src);
        else reject(new Error("Não foi possível carregar a imagem."));
      };

      img.src = src;
    });
  }

  // Handle image upload from file input
  static handleFileUpload(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error("Por favor, selecione um arquivo de imagem válido."));
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        ImageUtils.compressImage(e.target.result)
          .then(compressed => resolve(compressed))
          .catch(() => resolve(e.target.result));
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }

  // Extract pasted image from clipboard event (Blob, Data URL, HTML img src, Text URL)
  static getPastedImage(event) {
    return new Promise((resolve) => {
      const clipboardData = event.clipboardData || window.clipboardData;
      if (!clipboardData) return resolve(null);

      // 1. Check clipboard files
      if (clipboardData.files && clipboardData.files.length > 0) {
        const file = clipboardData.files[0];
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            ImageUtils.compressImage(e.target.result)
              .then(compressed => resolve(compressed))
              .catch(() => resolve(e.target.result));
          };
          reader.readAsDataURL(file);
          return;
        }
      }

      // 2. Check clipboard items for image blobs
      const items = clipboardData.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            if (blob) {
              const reader = new FileReader();
              reader.onload = (e) => {
                ImageUtils.compressImage(e.target.result)
                  .then(compressed => resolve(compressed))
                  .catch(() => resolve(e.target.result));
              };
              reader.readAsDataURL(blob);
              return;
            }
          }
        }
      }

      // 3. Check clipboard HTML for <img src="...">
      const htmlText = clipboardData.getData('text/html');
      if (htmlText) {
        const match = htmlText.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match && match[1]) {
          const imgUrl = match[1];
          ImageUtils.compressImage(imgUrl)
            .then(compressed => resolve(compressed))
            .catch(() => resolve(imgUrl));
          return;
        }
      }

      // 4. Check plain text for URL or Base64 string
      const plainText = clipboardData.getData('text');
      if (plainText) {
        const trimmed = plainText.trim();
        if (trimmed.startsWith('data:image/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          ImageUtils.compressImage(trimmed)
            .then(compressed => resolve(compressed))
            .catch(() => resolve(trimmed));
          return;
        }
      }

      resolve(null);
    });
  }

  // Google Images Quick Search
  static openGoogleImageSearch(productDescription) {
    const query = encodeURIComponent(productDescription);
    const searchUrl = `https://www.google.com/search?tbm=isch&q=${query}`;
    window.open(searchUrl, '_blank');
  }
}
