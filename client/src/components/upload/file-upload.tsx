import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudUpload, FileAudio, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Employee } from "@shared/schema";

interface UploadFile {
  file: File;
  employeeId: string;
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error';
  error?: string;
}

export default function FileUpload() {
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ["/api/employees"],
  });

const uploadMutation = useMutation({
    mutationFn: async ({ file, employeeId }: { file: File; employeeId:string }) => {
      // ...fetch logic (this part stays the same)...
    },
    onSuccess: () => {
      // This part stays the same
      queryClient.invalidateQueries({ queryKey: ["/api/calls"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/metrics"] });
      
      // ADD THIS: Show a success toast
      toast({
        title: "Upload Successful",
        description: "Your file is now being processed.",
        variant: "default", // This usually results in a green or neutral color
      });
    },
    onError: (error) => {
      // ADD THIS: Show an error toast
      toast({
        title: "Upload Failed",
        description: error.message || "An unknown error occurred.",
        variant: "destructive", // This usually results in a red color
      });
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = acceptedFiles.map(file => ({
      file,
      employeeId: '',
      progress: 0,
      status: 'pending' as const,
    }));
    setUploadFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.m4a', '.mp4', '.flac', '.ogg'],
    },
    maxSize: 500 * 1024 * 1024, // 500MB
  });

  const updateFile = (index: number, updates: Partial<UploadFile>) => {
    setUploadFiles(prev => prev.map((file, i) => 
      i === index ? { ...file, ...updates } : file
    ));
  };

  const removeFile = (index: number) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadFile = async (index: number) => {
    const fileData = uploadFiles[index];
    if (!fileData.employeeId) {
      toast({
        title: "Employee Required",
        description: "Please select an employee for this call recording.",
        variant: "destructive",
      });
      return;
    }

    try {
      updateFile(index, { status: 'uploading', progress: 0 });
      
      // Simulate upload progress
      const progressInterval = setInterval(() => {
        setUploadFiles(prev => {
          const current = prev[index];
          if (current && current.progress < 90) {
            const newFiles = [...prev];
            newFiles[index] = { ...current, progress: current.progress + 10 };
            return newFiles;
          }
          return prev;
        });
      }, 200);

      await uploadMutation.mutateAsync({
        file: fileData.file,
        employeeId: fileData.employeeId,
      });

      clearInterval(progressInterval);
      updateFile(index, { status: 'processing', progress: 100 });

      toast({
        title: "Upload Successful",
        description: "Your call recording is being processed with AssemblyAI.",
      });

      // Remove file after a delay
      setTimeout(() => removeFile(index), 3000);

    } catch (error) {
      updateFile(index, { 
        status: 'error', 
        error: error instanceof Error ? error.message : 'Upload failed' 
      });
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload call recording",
        variant: "destructive",
      });
    }
  };

  const uploadAll = () => {
    uploadFiles.forEach((file, index) => {
      if (file.status === 'pending' && file.employeeId) {
        uploadFile(index);
      }
    });
  };

  return (
    <div className="bg-card rounded-lg border border-border p-6" data-testid="file-upload">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Upload Call Recordings</h3>
        <div className="flex items-center space-x-2 text-sm text-muted-foreground">
          <span>Supports MP3, WAV, M4A up to 500MB</span>
        </div>
      </div>
      
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragActive 
            ? 'border-primary bg-primary/5' 
            : 'border-border hover:border-primary'
        }`}
        data-testid="dropzone"
      >
        <input {...getInputProps()} />
        <div className="space-y-4">
          <div className="w-16 h-16 mx-auto bg-muted rounded-full flex items-center justify-center">
            <CloudUpload className="text-2xl text-muted-foreground w-8 h-8" />
          </div>
          <div>
            <p className="text-lg font-medium text-foreground">
              {isDragActive ? 'Drop your files here' : 'Drop your call recordings here'}
            </p>
            <p className="text-muted-foreground">or click to browse files</p>
          </div>
          <Button type="button" data-testid="select-files-button">
            Select Files
          </Button>
        </div>
      </div>
      
      {uploadFiles.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-foreground">Files to Upload</h4>
            <Button type="button" onClick={uploadAll} disabled={uploadMutation.isPending} data-testid="upload-all-button">
              Upload All
            </Button>
          </div>

          {uploadFiles.map((fileData, index) => (
            <div key={index} className="flex items-center space-x-4 p-4 bg-muted rounded-lg">
              <FileAudio className="text-primary w-8 h-8 flex-shrink-0" />
              
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate" data-testid={`file-name-${index}`}>
                  {fileData.file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(fileData.file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
                
                {fileData.status === 'uploading' && (
                  <div className="mt-2">
                    <Progress value={fileData.progress} className="h-2" />
                    <p className="text-xs text-muted-foreground mt-1">
                      Uploading... {fileData.progress}%
                    </p>
                  </div>
                )}
                
                {fileData.status === 'processing' && (
                  <p className="text-xs text-blue-600 mt-1">Processing with AssemblyAI...</p>
                )}
                
                {fileData.status === 'completed' && (
                  <p className="text-xs text-green-600 mt-1">Upload completed!</p>
                )}
                
                {fileData.status === 'error' && (
                  <p className="text-xs text-red-600 mt-1">{fileData.error}</p>
                )}
              </div>
              
              <div className="flex items-center space-x-2">
                <Select
                  value={fileData.employeeId}
                  onValueChange={(value) => updateFile(index, { employeeId: value })}
                  disabled={fileData.status === 'uploading' || fileData.status === 'processing'}
                >
                  <SelectTrigger className="w-40" data-testid={`employee-select-${index}`}>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees?.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        {employee.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {fileData.status === 'pending' && (
                  <Button 
                    size="sm" 
                    onClick={() => uploadFile(index)}
                    disabled={!fileData.employeeId || uploadMutation.isPending}
                    data-testid={`upload-file-${index}`}
                  >
                    Upload
                  </Button>
                )}
                
                <Button 
                  size="sm" 
                  variant="ghost" 
                  onClick={() => removeFile(index)}
                  disabled={fileData.status === 'uploading'}
                  data-testid={`remove-file-${index}`}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
