/* Module: media — extracted from app.js */
/* Media/Transcoder tab logic: file upload handling, drag-and-drop, transcoder select trigger */

        // -------------------------------------------------------------
        // ASYNC TRANSCODER FILE LOADER
        // -------------------------------------------------------------
        
        function setupDragAndDrop() {
            const dropArea = document.getElementById('file-drop-area');
            const fileInput = document.getElementById('transcoder-file-input');

            dropArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropArea.classList.add('dragover');
            });

            dropArea.addEventListener('dragleave', () => {
                dropArea.classList.remove('dragover');
            });

            dropArea.addEventListener('drop', (e) => {
                e.preventDefault();
                dropArea.classList.remove('dragover');
                const file = e.dataTransfer.files[0];
                if (file) handleMediaFileUpload(file);
            });

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) handleMediaFileUpload(file);
            });
        }

        function triggerTranscoderSelect() {
            document.getElementById('transcoder-file-input').click();
        }

        async function handleMediaFileUpload(file) {
            if (file.size > 300 * 1024 * 1024) {
                alert('File is too large! Max file size limit is 300MB.');
                return;
            }

            const formData = new FormData();
            formData.append('mediaFile', file);
            
            alert(`Uploading ${file.name} to transcoder queue service...`);

            try {
                const res = await fetch('/api/transcode', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (data.success) {
                    alert('Upload complete! Video queue encoding started.');
                } else {
                    alert('Transcode job creation failed.');
                }
            } catch (e) {
                alert('Network upload failed. Ensure server is running.');
            }
        }
