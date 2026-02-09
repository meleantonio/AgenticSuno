const path = require('path');

module.exports = {
    mode: 'development',
    target: 'node', // extensions run in a node context
    entry: {
        extension: './src/extension.ts'
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        libraryTarget: 'commonjs',
        devtoolModuleFilenameTemplate: '../[resource-path]'
    },
    devtool: 'nosources-source-map',
    externals: {
        'vscode': 'commonjs vscode', // ignored because it doesn't exist
        'ws': 'commonjs ws',
    },
    resolve: {
        extensions: ['.ts', '.js'],
        mainFields: ['module', 'main']
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader'
                    }
                ]
            }
        ]
    }
};
