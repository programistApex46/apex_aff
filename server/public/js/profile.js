(function () {
  var input = document.getElementById('profile-avatar-input');
  var modal = document.getElementById('avatar-crop-modal');
  var cropImage = document.getElementById('avatar-crop-image');
  var cancelBtn = document.getElementById('avatar-crop-cancel');
  var cancelTopBtn = document.getElementById('avatar-crop-cancel-top');
  var saveBtn = document.getElementById('avatar-crop-save');
  var cropper = null;
  var objectUrl = null;

  function cleanup() {
    if (cropper) {
      cropper.destroy();
      cropper = null;
    }
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    if (cropImage) cropImage.removeAttribute('src');
    if (input) input.value = '';
    if (saveBtn) saveBtn.disabled = false;
  }

  function closeModal() {
    if (modal && modal.open) modal.close();
    cleanup();
  }

  function openCropper(file) {
    if (typeof Cropper === 'undefined') {
      alert('Crop editor failed to load. Refresh the page.');
      return;
    }

    cleanup();
    objectUrl = URL.createObjectURL(file);
    cropImage.src = objectUrl;
    modal.showModal();

    cropImage.onload = function () {
      if (cropper) cropper.destroy();

      cropper = new Cropper(cropImage, {
        aspectRatio: 1,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 1,
        responsive: true,
        background: false,
        guides: false,
        center: true,
        highlight: false,
        cropBoxMovable: false,
        cropBoxResizable: false,
        toggleDragModeOnDblclick: false,
        minContainerWidth: 200,
        minContainerHeight: 200,
      });
    };
  }

  input?.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Choose an image');
      input.value = '';
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      alert('File is larger than 2 MB');
      input.value = '';
      return;
    }

    openCropper(file);
  });

  cancelBtn?.addEventListener('click', closeModal);
  cancelTopBtn?.addEventListener('click', closeModal);
  modal?.addEventListener('close', cleanup);

  saveBtn?.addEventListener('click', function () {
    if (!cropper) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    var canvas = cropper.getCroppedCanvas({
      width: 512,
      height: 512,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });

    if (!canvas) {
      alert('Could not process the image');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      return;
    }

    canvas.toBlob(
      function (blob) {
        if (!blob) {
          alert('Could not process the image');
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          return;
        }

        var formData = new FormData();
        formData.append('avatar', blob, 'avatar.jpg');

        fetch('/profile/avatar', {
          method: 'POST',
          body: formData,
          credentials: 'same-origin',
          headers: {
            'HX-Request': 'true',
            'HX-Target': 'rh-page',
          },
        })
          .then(function (res) {
            if (!res.ok) throw new Error('upload failed');
            return res.text();
          })
          .then(function (html) {
            closeModal();
            var page = document.getElementById('rh-page');
            if (page) {
              page.innerHTML = html;
              if (typeof htmx !== 'undefined') htmx.process(page);
              if (typeof window.applyRhPageMeta === 'function') window.applyRhPageMeta(page);
            }
          })
          .catch(function () {
            alert('Could not upload avatar');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          });
      },
      'image/jpeg',
      0.92
    );
  });
})();
