const https = require('https');
const fs = require('fs');
const path = require('path');

// Configuration
const TIMEOUT = 1;
const OUTPUT_DIR = 'build';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const IP_VERSIONS = ['v4', 'v6'];

// Generate list configurations dynamically
const LISTS = IP_VERSIONS.map(version => ({
    version,
    url: `https://www.spamhaus.org/drop/drop_${version}.json`,
    listName: `spamhaus-drop-${version}`,
    commandPath: `/ip${version === 'v6' ? 'v6' : ''}`,
    validator: version === 'v4' ? isIPv4 : isIPv6
}));

// Helper function to format current date and time
function getFormattedDateTime() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').split('.')[0];
}

// Validate IPv4 address (including optional CIDR)
function isIPv4(ip) {
    return /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/[0-9]{1,2})?$/.test(ip);
}

// Validate IPv6 address (including optional CIDR)
function isIPv6(ip) {
    return /^([0-9a-fA-F]{1,4}:){1,7}(:[0-9a-fA-F]{1,4}|:)(?:\/[0-9]{1,3})?$/.test(ip);
}

// Fetch IP list from source URL with retry
async function fetchIPList(url, validator) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            return await new Promise((resolve, reject) => {
                https.get(url, (res) => {
                    let data = '';

                    if (res.statusCode !== 200) {
                        reject(new Error(`Request failed with status ${res.statusCode}`));
                        return;
                    }

                    res.on('data', (chunk) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        try {
                            let ipList = [];
                            let skippedLines = 0;

                            // Parse JSON Lines
                            ipList = data
                                .split('\n')
                                .map(line => {
                                    try {
                                        const obj = JSON.parse(line.trim());
                                        if (obj.cidr && validator(obj.cidr)) {
                                            return obj.cidr;
                                        }
                                        skippedLines++;
                                        return null;
                                    } catch (error) {
                                        skippedLines++;
                                        return null;
                                    }
                                })
                                .filter(cidr => cidr !== null);

                            if (ipList.length === 0) {
                                console.log(`Warning: No valid ${validator.name} addresses found after parsing.`);
                            }
                            if (skippedLines > 0) {
                                console.log(`Skipped ${skippedLines} invalid or non-CIDR lines for ${validator.name}.`);
                            }
                            resolve(ipList);
                        } catch (error) {
                            reject(new Error(`Failed to parse IP list: ${error.message}`));
                        }
                    });
                }).on('error', (error) => {
                    reject(new Error(`Request error: ${error.message}`));
                });
            });
        } catch (error) {
            retries++;
            if (retries === MAX_RETRIES) {
                throw new Error(`Failed after ${MAX_RETRIES} retries: ${error.message}`);
            }
            console.log(`Retrying (${retries}/${MAX_RETRIES}) for ${url}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }
}

// Generate RouterOS script
function generateRouterOSScript(ips, listName, commandPath) {
    const dateTime = getFormattedDateTime();

    // Start building the script
    let script = `# Generated on ${dateTime}\n`;
    script += `${commandPath} firewall address-list remove [find list=${listName}]\n`;
    script += ':local ips { \\\n';

    // Format each IP
    ips.forEach((ip, index) => {
        script += `{ "${ip}" }`;
        if (index < ips.length - 1) {
            script += ';';
        }
        script += '\\\n';
    });

    // Close the array and add foreach loop
    script += '};\n';
    script += `:foreach ip in=$ips do={\n`;
    script += `\t${commandPath} firewall address-list add list=${listName} address=$ip dynamic=yes timeout=${TIMEOUT}d\n`;
    script += '}\n';
    script += `:set ips\n`;

    return script;
}

// Main execution
async function main() {
    try {
        // Ensure build directory exists
        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR, {
                recursive: true
            });
        }

        // Process each list (IPv4 and IPv6)
        for (const list of LISTS) {
            console.log(`Fetching ${list.version} addresses from ${list.url}...`);
            const ipData = await fetchIPList(list.url, list.validator);

            if (!ipData.length) {
                console.log(`No valid ${list.version} addresses found for ${list.listName}.`);
                continue;
            }

            console.log(`Found ${ipData.length} ${list.version} addresses. Generating RouterOS script for ${list.listName}...`);
            const routerOsScript = generateRouterOSScript(ipData, list.listName, list.commandPath);

            // Write script to .rsc file
            const outputFile = path.join(OUTPUT_DIR, `${list.listName}.rsc`);
            fs.writeFileSync(outputFile, routerOsScript);
            console.log(`Script saved to ${outputFile}`);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Run the script
main();
