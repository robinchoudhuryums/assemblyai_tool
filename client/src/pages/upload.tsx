import FileUpload from "@/components/upload/file-upload";

export default function Upload() {
  return (
    <div className="min-h-screen" data-testid="upload-page">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Upload Call Recordings</h2>
          <p className="text-muted-foreground">Upload audio files to analyze with AssemblyAI for transcription and sentiment analysis</p>
        </div>
      </header>

      <div className="p-6">
        <FileUpload />
        
        {/* Instructions */}
        <div className="mt-8 bg-card rounded-lg border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Upload Instructions</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-foreground mb-2">Supported Formats</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• MP3 - Most common audio format</li>
                <li>• WAV - High quality uncompressed</li>
                <li>• M4A - Apple audio format</li>
                <li>• MP4 - Video files with audio</li>
                <li>• FLAC - Lossless compression</li>
                <li>• OGG - Open source format</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-medium text-foreground mb-2">Processing Features</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Automatic speech-to-text transcription</li>
                <li>• Real-time sentiment analysis</li>
                <li>• Speaker identification</li>
                <li>• Topic extraction and categorization</li>
                <li>• Performance scoring</li>
                <li>• AI-powered feedback generation</li>
              </ul>
            </div>
          </div>
          
          <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <strong>Note:</strong> Processing typically takes 2-3 minutes per audio file.
              You'll receive real-time updates on the transcription status.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
