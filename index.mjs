import mm from 'music-metadata';
import glob from 'glob-promise';
import log from 'npmlog';
import { copyFile, stat, mkdir } from 'fs/promises';
import { createWriteStream } from 'fs';
import { basename, extname, join } from 'path';

const inputDir = join(process.env.HOME, 'Plex', 'Music');
const lostDir = join(process.env.HOME, 'Plex', '?');
const outputDir = join(process.env.HOME, 'Downloads', 'output');
const extensions = ['mp3', 'm4a'];

const logPrefix = 'RE-MIXER';
const mkdirOpts = { recursive: true};
const metadataTagTypes = { None: 0 };

const parseFiles = async (audioFiles) => {
    let numSuccesses = 0;
    for (const audioFile of audioFiles) {
        log.info(logPrefix, '\tProcessing %s', audioFile);
        let metadata;
        try {
            metadata = await mm.parseFile(audioFile);
            if (metadata.format.tagTypes.length === 0) {
                metadataTagTypes['None']++;
                log.warn(logPrefix, '\tNo metadata tags %s', audioFile);
                const audioFileBasename = basename(audioFile);
                await copyFile(audioFile, `${lostDir}/${audioFileBasename}`);
                continue;
            }
            metadata.format.tagTypes.forEach(tagType => {
                if (!metadataTagTypes[tagType]) {
                    metadataTagTypes[tagType] = 1;
                }
                else {
                    metadataTagTypes[tagType]++;
                }
            });
        }
        catch (error) {
            log.error(logPrefix, 'Error occurred while parsing audio file %s! %s', audioFile, error.message);
        }
        let { artist, album, albumartist, title, track, picture } = metadata.common;
        if (!isValidSongMetadata(artist, album, albumartist, title, track, picture)) {
            const audioFileBasename = basename(audioFile);
            await copyFile(audioFile, `${lostDir}/${audioFileBasename}`);
            continue;
        }
        artist = sanitizeFilenameComponent(artist);
        album = sanitizeFilenameComponent(album);
        if (albumartist) {
            albumartist = sanitizeFilenameComponent(albumartist);
        }
        title = sanitizeFilenameComponent(title);
        track = standardizeFilenameTrack(track);
        const albumArtist = albumartist ? albumartist : album;
        const songFilePathName = getSongFilePathName(audioFile, albumArtist, album, title, track);
        await createArtistAlbumPath(albumArtist, album);
        await copyFile(audioFile, songFilePathName);
        log.info(logPrefix, '\t%s >>> %s', audioFile, songFilePathName);
        numSuccesses++;
    }
    return numSuccesses;
};

const isValidSongMetadata = (artist, album, albumArtist, title, track, picture) => {
    const artistExists = verifyMetadataComponentExists('Artist', artist);
    const albumExists = verifyMetadataComponentExists('Album', album);
    verifyMetadataComponentExists('Album Artist', albumArtist);
    const titleExists = verifyMetadataComponentExists('Title', title);
    verifyMetadataComponentExists('Picture', picture);
    const trackNoExists = verifyMetadataComponentExists('Track number', track.no);
    const trackOfExists = verifyMetadataComponentExists('Track number out of', track.of);

    return artistExists && albumExists && titleExists && trackNoExists && trackOfExists;
};

const verifyMetadataComponentExists = (datumName, datum) => {
    if (!datum) {
        log.warn(logPrefix, '\t\t%s metadata missing', datumName);
    }
    return Boolean(datum);
}

const sanitizeFilenameComponent = (fileName) => fileName
    .replaceAll('; ', '﹔')
    .replaceAll(';', '﹔')
    .replaceAll(': ', '：')
    .replaceAll(':', '﹕')
    .replaceAll('/', '∕')
    .replaceAll('...', '…');

const standardizeFilenameTrack = (track) => {
    const paddingLength = track.of.toString().length;
    return track.no.toString().padStart(paddingLength, '0');
};

const getSongFilePathName = (audioFile, albumArtist, album, title, track) => {
    const extension = extname(audioFile);
    const songFilePath = join(outputDir, albumArtist, album);
    return `${songFilePath}/${track} - ${title}${extension}`;
};

const directoryExists = async (directory) => {
    try {
        const stats = await stat(directory);
        return Boolean(stats);
    }
    catch (error) {
        return false
    }
};

const createArtistAlbumPath = async (artist, album) => {
    const artistAlbumPath = join(outputDir, artist, album);
    if (!await directoryExists(artistAlbumPath)) {
        log.info(logPrefix, "\t\tArtist/Album path %s does not exist. Creating now…", artistAlbumPath);
        await mkdir(artistAlbumPath, mkdirOpts);
    }
};


if (!await directoryExists('logs')) {
    await mkdir('logs');
}
log.stream = createWriteStream(`logs/${(new Date()).toISOString()}.log`);

log.info(logPrefix, 'Recursively scanning for %s files found within input path %s', extensions.toString(), inputDir);
const globExtensionComponent = extensions.length === 1 ? extensions[0] : `{${extensions.toString()}}`;
const filesToParse = await glob(`${inputDir}/**/*.${globExtensionComponent}`);
log.info(logPrefix, 'Found %d audio files (%s) to process within %s', filesToParse.length, extensions.toString(), inputDir);
const numSuccessfullyProcessed = await parseFiles(filesToParse);
log.info(logPrefix, 'Processed files: %d', filesToParse.length);
log.info(logPrefix, 'Automatically organized files: %d', numSuccessfullyProcessed);
log.info(logPrefix, 'Files needing manual intervention: %d', filesToParse.length - numSuccessfullyProcessed);
log.info(logPrefix, 'Metadata tag types encountered (multiples can occur)', metadataTagTypes);
