using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Launcher
{
    private const string VerifyArgument = "--verify";

    private static readonly string[] RequiredFiles =
    {
        @"app\index.html",
        @"app\assets\styles.css",
        @"app\js\domain.js",
        @"app\js\demo-data.js",
        @"app\js\storage.js",
        @"app\js\app.js"
    };

    [STAThread]
    private static int Main(string[] arguments)
    {
        bool verifyOnly = arguments.Length == 1 &&
            string.Equals(arguments[0], VerifyArgument, StringComparison.OrdinalIgnoreCase);

        try
        {
            string applicationRoot = AppDomain.CurrentDomain.BaseDirectory;
            ValidateFiles(applicationRoot);
            string browserPath = ResolveBrowserExecutable();
            if (verifyOnly)
            {
                return 0;
            }

            string indexPath = Path.Combine(applicationRoot, "app", "index.html");
            string pageUri = new Uri(indexPath).AbsoluteUri;
            Process.Start(new ProcessStartInfo(browserPath, QuoteArgument(pageUri)) { UseShellExecute = false });
            return 0;
        }
        catch (Exception error)
        {
            if (!verifyOnly)
            {
                MessageBox.Show(error.Message, "Software Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return 1;
        }
    }

    private static void ValidateFiles(string applicationRoot)
    {
        foreach (string relativePath in RequiredFiles)
        {
            FileInfo file = new FileInfo(Path.Combine(applicationRoot, relativePath));
            if (!file.Exists || file.Length == 0)
            {
                throw new InvalidDataException("Required application file is missing: " + relativePath);
            }
        }
    }

    private static string ResolveBrowserExecutable()
    {
        string configuredPath = Environment.GetEnvironmentVariable("SOFTWARE_LAUNCHER_BROWSER");
        if (!string.IsNullOrWhiteSpace(configuredPath))
        {
            if (File.Exists(configuredPath))
            {
                return configuredPath;
            }
            throw new FileNotFoundException("Configured browser was not found.", configuredPath);
        }

        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates =
        {
            ReadAppPath(Registry.CurrentUser, @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"),
            ReadAppPath(Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"),
            Path.Combine(programFilesX86, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(programFiles, @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(localAppData, @"Microsoft\Edge\Application\msedge.exe"),
            ReadAppPath(Registry.CurrentUser, @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
            ReadAppPath(Registry.LocalMachine, @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
            Path.Combine(programFiles, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(programFilesX86, @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(localAppData, @"Google\Chrome\Application\chrome.exe")
        };
        foreach (string candidate in candidates)
        {
            if (!string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate))
            {
                return candidate;
            }
        }
        throw new FileNotFoundException("Microsoft Edge or Google Chrome was not found. Install a supported browser and try again.");
    }

    private static string ReadAppPath(RegistryKey root, string subKeyName)
    {
        try
        {
            using (RegistryKey key = root.OpenSubKey(subKeyName))
            {
                return key == null ? null : key.GetValue(null) as string;
            }
        }
        catch
        {
            return null;
        }
    }

    private static string QuoteArgument(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
