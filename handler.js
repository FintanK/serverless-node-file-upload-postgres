const { Client } = require('pg');
const formidable = require('formidable');
const AWS = require('aws-sdk'); // For S3 (if used)

// Database connection details (environment variables for production)
const { PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT } = process.env;

const dbConfig = {
    host: PGHOST || 'localhost', // Use localhost for local Docker
    user: PGUSER || 'postgres',
    password: PGPASSWORD || 'password', // Replace with your password
    database: PGDATABASE || 'mydb',
    port: PGPORT || 5432,
};

// S3 Configuration (if storing files on S3)
const s3 = new AWS.S3({ });
const BUCKET_NAME = 'uploads-s3-bucket';

module.exports.main = async (event) => {
    const client = new Client(dbConfig);
    await client.connect();

    try {
        if (event.httpMethod === 'POST' && event.path === '/upload') {
            const form = new formidable.IncomingForm();

            return new Promise((resolve, reject) => {
                form.parse(event, async (err, fields, files) => {
                    if (err) {
                        reject({ statusCode: 500, body: JSON.stringify({ error: 'File upload failed' }) });
                        return;
                    }

                    const file = files.file; // Assuming 'file' is the field name
                    if (!file) {
                      reject({ statusCode: 400, body: JSON.stringify({ error: 'No file uploaded' }) });
                      return;
                    }

                    const { filepath, originalFilename } = file;

                    // Option 1: Store locally (less common in serverless)
                    // const newFilepath = `/tmp/${originalFilename}`; // Important: Use /tmp in Lambda
                    // await fs.promises.rename(filepath, newFilepath);

                    // Option 2: Store on S3 (Recommended for serverless)
                    await s3.upload({
                        Bucket: BUCKET_NAME,
                        Key: originalFilename,
                        Body: fs.createReadStream(filepath),
                    }).promise();
                    const fileUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${originalFilename}`;

                    // Insert into database
                    const query = 'INSERT INTO uploads (filename, filepath) VALUES ($1, $2) RETURNING *'; // Use fileUrl if storing on S3
                    const result = await client.query(query, [originalFilename, filepath]); // Use fileUrl if storing on S3

                    resolve({
                        statusCode: 200,
                        body: JSON.stringify({ message: 'File uploaded successfully', upload: result.rows[0] }),
                    });
                });
            });
        } else {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'Route not found' }),
            };
        }
    } catch (error) {
        console.error(error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' }),
        };
    } finally {
        await client.end();
    }
};