# Forex Trading Assistant - Backtesting Module
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import yfinance as yf
from datetime import datetime, timedelta
import talib
from sklearn.preprocessing import MinMaxScaler
import seaborn as sns
from tqdm import tqdm
import pytz

class ForexBacktester:
    def __init__(self, trading_assistant, start_date=None, end_date=None):
        """
        Initialize the backtesting system
        
        Parameters:
        -----------
        trading_assistant : ForexTradingAssistant
            The trading assistant instance to backtest
        start_date : datetime
            Start date for backtesting
        end_date : datetime
            End date for backtesting
        """
        self.trading_assistant = trading_assistant
        self.start_date = start_date or (datetime.now() - timedelta(days=3*365))
        self.end_date = end_date or datetime.now()
        self.results = {}
        self.trade_history = {}
        self.performance_metrics = {}
        
    def fetch_historical_data(self, symbols=None, interval='1h'):
        """Fetch historical data for backtesting"""
        symbols = symbols or self.trading_assistant.symbols
        
        print(f"Fetching historical data from {self.start_date.strftime('%Y-%m-%d')} to {self.end_date.strftime('%Y-%m-%d')}")
        
        for symbol in symbols:
            try:
                data = yf.download(
                    symbol, 
                    start=self.start_date, 
                    end=self.end_date, 
                    interval=interval
                )
                
                if not data.empty:
                    self.trading_assistant.market_data[symbol] = data
                    print(f"Successfully loaded {len(data)} periods of historical data for {symbol}")
                else:
                    print(f"No data available for {symbol}")
            except Exception as e:
                print(f"Error fetching data for {symbol}: {e}")
    
    def run_backtest(self, initial_capital=10000.0, position_size_pct=2.0, symbols=None):
        """
        Run the backtest on historical data
        
        Parameters:
        -----------
        initial_capital : float
            Starting capital for backtest
        position_size_pct : float
            Position size as percentage of capital
        symbols : list
            List of symbols to backtest
        """
        symbols = symbols or self.trading_assistant.symbols
        
        # Calculate indicators and generate signals
        self.trading_assistant.calculate_indicators()
        self.trading_assistant.generate_signals()
        
        for symbol in symbols:
            if symbol not in self.trading_assistant.signals:
                print(f"No signals generated for {symbol}, skipping backtest")
                continue
            
            print(f"Running backtest for {symbol}...")
            
            # Initialize results tracking
            signals = self.trading_assistant.signals[symbol].copy()
            backtest_results = signals.copy()
            
            # Trading parameters
            capital = initial_capital
            position_size = capital * (position_size_pct / 100)
            in_position = False
            position_type = None
            entry_price = 0
            stop_loss = 0
            take_profit = 0
            entry_date = None
            
            trades = []
            
            # Add columns for backtest results
            backtest_results['Capital'] = initial_capital
            backtest_results['Position'] = None
            backtest_results['EntryPrice'] = np.nan
            backtest_results['StopLoss'] = np.nan
            backtest_results['TakeProfit'] = np.nan
            backtest_results['PnL'] = 0.0
            backtest_results['PnL_Pct'] = 0.0
            backtest_results['Trade_Result'] = None
            
            # Loop through the signals dataframe
            for i, (idx, row) in enumerate(tqdm(signals.iterrows(), total=len(signals))):
                current_price = row['Close']
                
                # Skip first few rows that might have NaN due to indicator calculations
                if pd.isna(row['Combined_Signal']):
                    continue
                
                # Check if we are in a position
                if in_position:
                    # Check for exit conditions (SL, TP, or opposing signal)
                    exit_signal = False
                    exit_reason = None
                    
                    if position_type == 'BUY':
                        # Stop loss hit
                        if current_price <= stop_loss:
                            exit_signal = True
                            exit_reason = 'Stop Loss'
                        # Take profit hit
                        elif current_price >= take_profit:
                            exit_signal = True
                            exit_reason = 'Take Profit'
                        # Strong sell signal
                        elif row['Strong_Sell']:
                            exit_signal = True
                            exit_reason = 'Reverse Signal'
                    
                    elif position_type == 'SELL':
                        # Stop loss hit
                        if current_price >= stop_loss:
                            exit_signal = True
                            exit_reason = 'Stop Loss'
                        # Take profit hit
                        elif current_price <= take_profit:
                            exit_signal = True
                            exit_reason = 'Take Profit'
                        # Strong buy signal
                        elif row['Strong_Buy']:
                            exit_signal = True
                            exit_reason = 'Reverse Signal'
                    
                    # Process exit if needed
                    if exit_signal:
                        if position_type == 'BUY':
                            profit = (current_price - entry_price) * (position_size / entry_price)
                            profit_pct = (current_price - entry_price) / entry_price * 100
                        else:  # SELL
                            profit = (entry_price - current_price) * (position_size / entry_price)
                            profit_pct = (entry_price - current_price) / entry_price * 100
                        
                        capital += profit
                        
                        # Record the trade
                        trade = {
                            'Symbol': symbol,
                            'Entry_Date': entry_date,
                            'Entry_Price': entry_price,
                            'Exit_Date': idx,
                            'Exit_Price': current_price,
                            'Type': position_type,
                            'PnL': profit,
                            'PnL_Pct': profit_pct,
                            'Exit_Reason': exit_reason,
                            'Position_Size': position_size,
                            'Duration': (idx - entry_date).total_seconds() / 3600  # Duration in hours
                        }
                        trades.append(trade)
                        
                        # Update results
                        backtest_results.loc[idx, 'Trade_Result'] = exit_reason
                        backtest_results.loc[idx, 'PnL'] = profit
                        backtest_results.loc[idx, 'PnL_Pct'] = profit_pct
                        
                        # Reset position
                        in_position = False
                        position_type = None
                        
                        # Update position size based on new capital
                        position_size = capital * (position_size_pct / 100)
                
                # Check for entry conditions if not in a position
                if not in_position:
                    # Buy signal
                    if row['Strong_Buy']:
                        in_position = True
                        position_type = 'BUY'
                        entry_price = current_price
                        stop_loss = row['Suggested_SL_Buy']
                        take_profit = row['Suggested_TP_Buy']
                        entry_date = idx
                        
                        # Update results
                        backtest_results.loc[idx, 'Position'] = 'BUY'
                        backtest_results.loc[idx, 'EntryPrice'] = entry_price
                        backtest_results.loc[idx, 'StopLoss'] = stop_loss
                        backtest_results.loc[idx, 'TakeProfit'] = take_profit
                    
                    # Sell signal
                    elif row['Strong_Sell']:
                        in_position = True
                        position_type = 'SELL'
                        entry_price = current_price
                        stop_loss = row['Suggested_SL_Sell']
                        take_profit = row['Suggested_TP_Sell']
                        entry_date = idx
                        
                        # Update results
                        backtest_results.loc[idx, 'Position'] = 'SELL'
                        backtest_results.loc[idx, 'EntryPrice'] = entry_price
                        backtest_results.loc[idx, 'StopLoss'] = stop_loss
                        backtest_results.loc[idx, 'TakeProfit'] = take_profit
                
                # Update capital in results
                backtest_results.loc[idx, 'Capital'] = capital
            
            # Close any open position at the end of the backtest
            if in_position:
                last_price = backtest_results['Close'].iloc[-1]
                
                if position_type == 'BUY':
                    profit = (last_price - entry_price) * (position_size / entry_price)
                    profit_pct = (last_price - entry_price) / entry_price * 100
                else:  # SELL
                    profit = (entry_price - last_price) * (position_size / entry_price)
                    profit_pct = (entry_price - last_price) / entry_price * 100
                
                capital += profit
                
                # Record the trade
                trade = {
                    'Symbol': symbol,
                    'Entry_Date': entry_date,
                    'Entry_Price': entry_price,
                    'Exit_Date': backtest_results.index[-1],
                    'Exit_Price': last_price,
                    'Type': position_type,
                    'PnL': profit,
                    'PnL_Pct': profit_pct,
                    'Exit_Reason': 'End of Backtest',
                    'Position_Size': position_size,
                    'Duration': (backtest_results.index[-1] - entry_date).total_seconds() / 3600  # Duration in hours
                }
                trades.append(trade)
            
            # Store results
            self.results[symbol] = backtest_results
            self.trade_history[symbol] = pd.DataFrame(trades)
            
            # Calculate performance metrics
            self.calculate_performance_metrics(symbol, initial_capital)
    
    def calculate_performance_metrics(self, symbol, initial_capital):
        """Calculate performance metrics for the backtest"""
        if symbol not in self.trade_history:
            return
        
        trades_df = self.trade_history[symbol]
        
        if trades_df.empty:
            print(f"No trades found for {symbol} during the backtest period")
            return
        
        # Calculate metrics
        total_trades = len(trades_df)
        winning_trades = len(trades_df[trades_df['PnL'] > 0])
        losing_trades = len(trades_df[trades_df['PnL'] <= 0])
        win_rate = winning_trades / total_trades * 100 if total_trades > 0 else 0
        
        total_profit = trades_df['PnL'].sum()
        max_profit = trades_df['PnL'].max() if not trades_df.empty else 0
        max_loss = trades_df['PnL'].min() if not trades_df.empty else 0
        
        avg_profit = trades_df[trades_df['PnL'] > 0]['PnL'].mean() if winning_trades > 0 else 0
        avg_loss = trades_df[trades_df['PnL'] <= 0]['PnL'].mean() if losing_trades > 0 else 0
        
        profit_factor = abs(trades_df[trades_df['PnL'] > 0]['PnL'].sum() / trades_df[trades_df['PnL'] < 0]['PnL'].sum()) if trades_df[trades_df['PnL'] < 0]['PnL'].sum() != 0 else float('inf')
        
        # Calculate drawdown
        capital_curve = self.results[symbol]['Capital'].copy()
        rolling_max = capital_curve.cummax()
        drawdown = (capital_curve - rolling_max) / rolling_max * 100
        max_drawdown = drawdown.min()
        
        # Calculate Sharpe ratio (using daily returns approximation)
        daily_returns = self.results[symbol]['PnL'].resample('D').sum() / initial_capital
        sharpe_ratio = np.sqrt(252) * daily_returns.mean() / daily_returns.std() if daily_returns.std() != 0 else 0
        
        # Store metrics
        self.performance_metrics[symbol] = {
            'Initial_Capital': initial_capital,
            'Final_Capital': self.results[symbol]['Capital'].iloc[-1],
            'Total_Return': (self.results[symbol]['Capital'].iloc[-1] - initial_capital) / initial_capital * 100,
            'Total_Trades': total_trades,
            'Winning_Trades': winning_trades,
            'Losing_Trades': losing_trades,
            'Win_Rate': win_rate,
            'Total_Profit': total_profit,
            'Max_Profit_Trade': max_profit,
            'Max_Loss_Trade': max_loss,
            'Average_Profit': avg_profit,
            'Average_Loss': avg_loss,
            'Profit_Factor': profit_factor,
            'Max_Drawdown': max_drawdown,
            'Sharpe_Ratio': sharpe_ratio
        }
    
    def display_performance_summary(self, symbol=None):
        """Display performance summary for one or all symbols"""
        if symbol:
            symbols = [symbol]
        else:
            symbols = list(self.performance_metrics.keys())
        
        for sym in symbols:
            if sym not in self.performance_metrics:
                print(f"No performance metrics available for {sym}")
                continue
            
            metrics = self.performance_metrics[sym]
            
            print(f"\n============= Performance Summary for {sym} =============")
            print(f"Test Period: {self.start_date.strftime('%Y-%m-%d')} to {self.end_date.strftime('%Y-%m-%d')}")
            print(f"Initial Capital: ${metrics['Initial_Capital']:.2f}")
            print(f"Final Capital: ${metrics['Final_Capital']:.2f}")
            print(f"Total Return: {metrics['Total_Return']:.2f}%")
            print(f"Total Trades: {metrics['Total_Trades']}")
            print(f"Win Rate: {metrics['Win_Rate']:.2f}%")
            print(f"Profit Factor: {metrics['Profit_Factor']:.2f}")
            print(f"Max Drawdown: {metrics['Max_Drawdown']:.2f}%")
            print(f"Sharpe Ratio: {metrics['Sharpe_Ratio']:.2f}")
            print(f"Average Profit: ${metrics['Average_Profit']:.2f}")
            print(f"Average Loss: ${metrics['Average_Loss']:.2f}")
            print(f"Max Profit Trade: ${metrics['Max_Profit_Trade']:.2f}")
            print(f"Max Loss Trade: ${metrics['Max_Loss_Trade']:.2f}")
    
    def plot_equity_curve(self, symbol):
        """Plot equity curve and drawdown for a symbol"""
        if symbol not in self.results:
            print(f"No results available for {symbol}")
            return
        
        results = self.results[symbol]
        
        # Calculate drawdown
        capital_curve = results['Capital'].copy()
        rolling_max = capital_curve.cummax()
        drawdown = (capital_curve - rolling_max) / rolling_max * 100
        
        # Create the figure and axes
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={'height_ratios': [3, 1]})
        
        # Plot equity curve
        ax1.plot(results.index, results['Capital'], label='Equity Curve')
        
        # Add buy and sell markers
        buys = results[results['Position'] == 'BUY']
        sells = results[results['Position'] == 'SELL']
        
        # Mark trade entries
        ax1.scatter(buys.index, buys['Capital'], marker='^', color='green', s=100, label='Buy Entry')
        ax1.scatter(sells.index, sells['Capital'], marker='v', color='red', s=100, label='Sell Entry')
        
        # Mark trade exits with PnL
        exits = results[results['Trade_Result'].notna()]
        for idx, row in exits.iterrows():
            color = 'green' if row['PnL'] > 0 else 'red'
            marker = 'o'
            ax1.scatter(idx, row['Capital'], marker=marker, color=color, s=80)
            ax1.annotate(f"${row['PnL']:.2f}", 
                        (idx, row['Capital']), 
                        xytext=(5, 10), 
                        textcoords='offset points',
                        fontsize=8,
                        color=color)
        
        ax1.set_title(f'{symbol} Equity Curve')
        ax1.set_ylabel('Capital ($)')
        ax1.legend()
        ax1.grid(True)
        
        # Plot drawdown
        ax2.fill_between(results.index, 0, drawdown, color='red', alpha=0.3)
        ax2.set_title('Drawdown')
        ax2.set_ylabel('Drawdown (%)')
        ax2.set_ylim(min(drawdown.min() * 1.5, -5), 5)  # Set y-axis limit with some margin
        ax2.grid(True)
        
        plt.tight_layout()
        plt.show()
    
    def plot_trade_distribution(self, symbol):
        """Plot trade distribution statistics"""
        if symbol not in self.trade_history:
            print(f"No trade history available for {symbol}")
            return
        
        trades = self.trade_history[symbol]
        
        if trades.empty:
            print(f"No trades found for {symbol}")
            return
        
        fig, axes = plt.subplots(2, 2, figsize=(14, 10))
        
        # Plot 1: Distribution of profits/losses
        sns.histplot(trades['PnL'], kde=True, ax=axes[0, 0], color='blue')
        axes[0, 0].axvline(x=0, color='r', linestyle='--')
        axes[0, 0].set_title('Distribution of Profits/Losses')
        axes[0, 0].set_xlabel('Profit/Loss ($)')
        axes[0, 0].set_ylabel('Frequency')
        
        # Plot 2: PnL by trade type
        sns.boxplot(x='Type', y='PnL', data=trades, ax=axes[0, 1])
        axes[0, 1].set_title('PnL by Trade Type')
        axes[0, 1].set_xlabel('Trade Type')
        axes[0, 1].set_ylabel('Profit/Loss ($)')
        
        # Plot 3: PnL by exit reason
        sns.boxplot(x='Exit_Reason', y='PnL', data=trades, ax=axes[1, 0])
        axes[1, 0].set_title('PnL by Exit Reason')
        axes[1, 0].set_xlabel('Exit Reason')
        axes[1, 0].set_ylabel('Profit/Loss ($)')
        plt.setp(axes[1, 0].xaxis.get_majorticklabels(), rotation=45)
        
        # Plot 4: PnL vs Duration
        sns.scatterplot(x='Duration', y='PnL', hue='Type', data=trades, ax=axes[1, 1])
        axes[1, 1].set_title('PnL vs Trade Duration')
        axes[1, 1].set_xlabel('Duration (hours)')
        axes[1, 1].set_ylabel('Profit/Loss ($)')
        
        plt.tight_layout()
        plt.show()
    
    def monthly_performance(self, symbol):
        """Calculate and display monthly performance"""
        if symbol not in self.trade_history:
            print(f"No trade history available for {symbol}")
            return None
        
        trades = self.trade_history[symbol]
        
        if trades.empty:
            print(f"No trades found for {symbol}")
            return None
        
        # Resample trades to monthly periods
        trades['Year_Month'] = trades['Exit_Date'].dt.to_period('M')
        monthly_pnl = trades.groupby('Year_Month')['PnL'].sum()
        monthly_trades = trades.groupby('Year_Month').size()
        monthly_win_rate = trades.groupby('Year_Month').apply(
            lambda x: (x['PnL'] > 0).sum() / len(x) * 100 if len(x) > 0 else 0
        )
        
        # Create monthly performance dataframe
        monthly_perf = pd.DataFrame({
            'PnL': monthly_pnl,
            'Trades': monthly_trades,
            'Win_Rate': monthly_win_rate
        })
        
        # Display monthly performance
        print(f"\n========== Monthly Performance for {symbol} ==========")
        print(monthly_perf)
        
        # Plot monthly performance
        fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 12), sharex=True)
        
        # Plot monthly P&L
        monthly_perf['PnL'].plot(kind='bar', ax=ax1, color=monthly_perf['PnL'].apply(lambda x: 'green' if x > 0 else 'red'))
        ax1.set_title(f'{symbol} Monthly P&L')
        ax1.set_ylabel('Profit/Loss ($)')
        ax1.set_xlabel('')
        ax1.grid(True, axis='y')
        
        # Plot number of trades per month
        monthly_perf['Trades'].plot(kind='bar', ax=ax2, color='blue')
        ax2.set_title('Number of Trades per Month')
        ax2.set_ylabel('Number of Trades')
        ax2.set_xlabel('')
        ax2.grid(True, axis='y')
        
        # Plot win rate per month
        monthly_perf['Win_Rate'].plot(kind='bar', ax=ax3, color='purple')
        ax3.set_title('Win Rate per Month (%)')
        ax3.set_ylabel('Win Rate (%)')
        ax3.set_xlabel('Month')
        ax3.grid(True, axis='y')
        
        plt.tight_layout()
        plt.show()
        
        return monthly_perf

    def generate_report(self, symbol, output_file=None):
        """Generate a comprehensive backtest report"""
        if symbol not in self.performance_metrics:
            print(f"No performance metrics available for {symbol}")
            return
        
        # Display performance summary
        self.display_performance_summary(symbol)
        
        # Plot equity curve
        self.plot_equity_curve(symbol)
        
        # Plot trade distribution
        self.plot_trade_distribution(symbol)
        
        # Display monthly performance
        self.monthly_performance(symbol)
        
        # TODO: If needed, save the report to a file


# Example usage
if __name__ == "__main__":
    # Define the symbols to backtest
    symbols_to_test = ['USDJPY=X', 'XAUUSD=X']  # JPY/USD and Gold/USD
    
    # Create the trading assistant
    assistant = ForexTradingAssistant(
        symbols=symbols_to_test,
        lookback_period='1095d',  # 3 years
        interval='1h'  # 1-hour timeframe
    )
    
    # Create the backtester
    backtester = ForexBacktester(
        trading_assistant=assistant,
        start_date=datetime.now() - timedelta(days=3*365),
        end_date=datetime.now()
    )
    
    # Fetch historical data
    backtester.fetch_historical_data(symbols=symbols_to_test)
    
    # Run the backtest
    backtester.run_backtest(
        initial_capital=10000.0,
        position_size_pct=2.0,
        symbols=symbols_to_test
    )
    
    # Generate reports for each symbol
    for symbol in symbols_to_test:
        print(f"\n\n==============================")
        print(f"  BACKTEST RESULTS: {symbol}")
        print(f"==============================")
        backtester.generate_report(symbol)




# Forex Trading Assistant - Proof of Concept
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import yfinance as yf
from datetime import datetime, timedelta
import talib
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout

class ForexTradingAssistant:
    def __init__(self, symbols=None, lookback_period='30d', interval='1h'):
        """
        Initialize the Forex Trading Assistant
        
        Parameters:
        -----------
        symbols : list
            List of forex pairs to analyze (e.g., 'EURUSD=X')
        lookback_period : str
            Period to look back for data analysis
        interval : str
            Data interval ('1m', '5m', '15m', '1h', etc.)
        """
        self.symbols = symbols or ['EURUSD=X', 'USDJPY=X', 'GBPUSD=X', 'XAUUSD=X']
        self.lookback_period = lookback_period
        self.interval = interval
        self.market_data = {}
        self.analysis_results = {}
        self.signals = {}
        self.models = {}
        
    def fetch_data(self):
        """Fetch market data for all symbols"""
        end_date = datetime.now()
        start_date = end_date - timedelta(days=int(self.lookback_period.replace('d', '')))
        
        for symbol in self.symbols:
            try:
                data = yf.download(
                    symbol, 
                    start=start_date, 
                    end=end_date, 
                    interval=self.interval
                )
                if not data.empty:
                    self.market_data[symbol] = data
                    print(f"Successfully loaded data for {symbol}")
                else:
                    print(f"No data available for {symbol}")
            except Exception as e:
                print(f"Error fetching data for {symbol}: {e}")
    
    def calculate_indicators(self):
        """Calculate technical indicators for analysis"""
        for symbol, data in self.market_data.items():
            df = data.copy()
            
            # Basic indicators
            df['SMA_20'] = talib.SMA(df['Close'], timeperiod=20)
            df['SMA_50'] = talib.SMA(df['Close'], timeperiod=50)
            df['RSI'] = talib.RSI(df['Close'], timeperiod=14)
            df['MACD'], df['MACD_Signal'], df['MACD_Hist'] = talib.MACD(
                df['Close'], fastperiod=12, slowperiod=26, signalperiod=9
            )
            df['ATR'] = talib.ATR(df['High'], df['Low'], df['Close'], timeperiod=14)
            df['Upper_BB'], df['Middle_BB'], df['Lower_BB'] = talib.BBANDS(
                df['Close'], timeperiod=20, nbdevup=2, nbdevdn=2
            )
            
            # Additional derived metrics
            df['SMA_Cross'] = np.where(df['SMA_20'] > df['SMA_50'], 1, -1)
            df['MACD_Signal_Cross'] = np.where(df['MACD'] > df['MACD_Signal'], 1, -1)
            df['Volatility'] = df['ATR'] / df['Close'] * 100
            df['BB_Width'] = (df['Upper_BB'] - df['Lower_BB']) / df['Middle_BB']
            df['Daily_Return'] = df['Close'].pct_change() * 100
            
            # Store results
            self.analysis_results[symbol] = df
    
    def generate_signals(self):
        """Generate trading signals based on technical analysis"""
        for symbol, df in self.analysis_results.items():
            signals = pd.DataFrame(index=df.index)
            signals['Symbol'] = symbol
            signals['Close'] = df['Close']
            
            # Define signal conditions
            signals['RSI_Signal'] = 0
            signals.loc[df['RSI'] < 30, 'RSI_Signal'] = 1  # Oversold - Buy signal
            signals.loc[df['RSI'] > 70, 'RSI_Signal'] = -1  # Overbought - Sell signal
            
            signals['MACD_Signal'] = df['MACD_Signal_Cross']
            
            signals['BB_Signal'] = 0
            signals.loc[df['Close'] < df['Lower_BB'], 'BB_Signal'] = 1  # Price below lower BB - Buy signal
            signals.loc[df['Close'] > df['Upper_BB'], 'BB_Signal'] = -1  # Price above upper BB - Sell signal
            
            signals['SMA_Signal'] = df['SMA_Cross']
            
            # Combine signals with simple weighting
            signals['Combined_Signal'] = (
                signals['RSI_Signal'] * 0.3 + 
                signals['MACD_Signal'] * 0.3 + 
                signals['BB_Signal'] * 0.2 + 
                signals['SMA_Signal'] * 0.2
            )
            
            # Generate strong signals where multiple indicators align
            signals['Strong_Buy'] = (signals['Combined_Signal'] > 0.5)
            signals['Strong_Sell'] = (signals['Combined_Signal'] < -0.5)
            
            # Calculate suggested SL and TP levels based on ATR
            signals['ATR'] = df['ATR']
            signals['Suggested_SL_Buy'] = signals['Close'] - 2 * signals['ATR']
            signals['Suggested_TP_Buy'] = signals['Close'] + 3 * signals['ATR']
            signals['Suggested_SL_Sell'] = signals['Close'] + 2 * signals['ATR']
            signals['Suggested_TP_Sell'] = signals['Close'] - 3 * signals['ATR']
            
            self.signals[symbol] = signals
    
    def build_prediction_model(self, symbol, lookback_steps=60, prediction_steps=10):
        """Build a simple LSTM model for price prediction"""
        if symbol not in self.market_data:
            print(f"No data available for {symbol}")
            return
        
        # Prepare data
        df = self.analysis_results[symbol].copy()
        df = df.dropna()
        
        if len(df) < lookback_steps + prediction_steps:
            print(f"Not enough data for {symbol} to build model")
            return
        
        # Feature selection and scaling
        features = ['Close', 'SMA_20', 'SMA_50', 'RSI', 'MACD', 'ATR', 'BB_Width', 'Volatility']
        target = 'Close'
        
        scaler = MinMaxScaler()
        scaled_data = scaler.fit_transform(df[features])
        
        # Create sequences for LSTM
        X, y = [], []
        for i in range(len(scaled_data) - lookback_steps - prediction_steps):
            X.append(scaled_data[i:i + lookback_steps])
            y.append(scaled_data[i + lookback_steps:i + lookback_steps + prediction_steps, 0])  # Predicting Close price
        
        X, y = np.array(X), np.array(y)
        
        # Split data
        train_size = int(len(X) * 0.8)
        X_train, X_test = X[:train_size], X[train_size:]
        y_train, y_test = y[:train_size], y[train_size:]
        
        # Build model
        model = Sequential()
        model.add(LSTM(100, return_sequences=True, input_shape=(lookback_steps, len(features))))
        model.add(Dropout(0.2))
        model.add(LSTM(50))
        model.add(Dropout(0.2))
        model.add(Dense(prediction_steps))
        
        model.compile(optimizer='adam', loss='mse')
        model.fit(X_train, y_train, epochs=20, batch_size=32, verbose=0)
        
        # Store model and scaler for later use
        self.models[symbol] = {
            'model': model,
            'scaler': scaler,
            'features': features,
            'lookback_steps': lookback_steps,
            'prediction_steps': prediction_steps
        }
        
        # Evaluate
        train_loss = model.evaluate(X_train, y_train, verbose=0)
        test_loss = model.evaluate(X_test, y_test, verbose=0)
        print(f"{symbol} Model - Train Loss: {train_loss:.4f}, Test Loss: {test_loss:.4f}")
    
    def predict_price_movement(self, symbol, time_horizon='short'):
        """Predict future price movement using trained model"""
        if symbol not in self.models:
            print(f"No model trained for {symbol}")
            return None
        
        # Get latest data for prediction
        df = self.analysis_results[symbol].copy().dropna()
        if len(df) < self.models[symbol]['lookback_steps']:
            print(f"Not enough data for prediction")
            return None
            
        # Prepare input data
        features = self.models[symbol]['features']
        scaler = self.models[symbol]['scaler']
        lookback_steps = self.models[symbol]['lookback_steps']
        
        latest_data = df[features].iloc[-lookback_steps:].values
        latest_data_scaled = scaler.transform(latest_data)
        X_pred = np.array([latest_data_scaled])
        
        # Make prediction
        prediction_scaled = self.models[symbol]['model'].predict(X_pred)[0]
        
        # Create dummy array to inverse transform
        dummy = np.zeros((len(prediction_scaled), len(features)))
        dummy[:, 0] = prediction_scaled  # Fill first column (Close price)
        
        # Inverse transform to get actual price values
        prediction = scaler.inverse_transform(dummy)[:, 0]
        
        latest_close = df['Close'].iloc[-1]
        predicted_direction = "UP" if prediction[0] > latest_close else "DOWN"
        predicted_change = abs(prediction[0] - latest_close)
        predicted_pct = predicted_change / latest_close * 100
        
        return {
            'symbol': symbol,
            'current_price': latest_close,
            'predicted_direction': predicted_direction,
            'predicted_first_target': prediction[0],
            'predicted_change': predicted_change,
            'predicted_pct': predicted_pct,
            'full_prediction': prediction
        }
    
    def visualize_signals(self, symbol, periods=100):
        """Visualize recent signals and predictions"""
        if symbol not in self.signals:
            print(f"No signals for {symbol}")
            return
        
        signals = self.signals[symbol].iloc[-periods:]
        df = self.analysis_results[symbol].iloc[-periods:]
        
        fig, axes = plt.subplots(3, 1, figsize=(14, 12), sharex=True)
        
        # Price and MA plot
        axes[0].plot(df.index, df['Close'], label='Close Price')
        axes[0].plot(df.index, df['SMA_20'], label='SMA 20')
        axes[0].plot(df.index, df['SMA_50'], label='SMA 50')
        axes[0].plot(df.index, df['Upper_BB'], 'k--', alpha=0.3)
        axes[0].plot(df.index, df['Middle_BB'], 'k--', alpha=0.3)
        axes[0].plot(df.index, df['Lower_BB'], 'k--', alpha=0.3)
        
        # Plot buy signals
        buy_signals = signals[signals['Strong_Buy'] == True]
        axes[0].scatter(buy_signals.index, buy_signals['Close'], 
                      marker='^', color='green', s=100, label='Buy Signal')
        
        # Plot sell signals
        sell_signals = signals[signals['Strong_Sell'] == True]
        axes[0].scatter(sell_signals.index, sell_signals['Close'], 
                      marker='v', color='red', s=100, label='Sell Signal')
        
        axes[0].set_title(f'{symbol} Price Chart with Signals')
        axes[0].set_ylabel('Price')
        axes[0].legend()
        axes[0].grid(True)
        
        # RSI plot
        axes[1].plot(df.index, df['RSI'], label='RSI')
        axes[1].axhline(y=70, color='r', linestyle='-', alpha=0.3)
        axes[1].axhline(y=30, color='g', linestyle='-', alpha=0.3)
        axes[1].set_title('RSI Indicator')
        axes[1].set_ylabel('RSI Value')
        axes[1].legend()
        axes[1].grid(True)
        
        # MACD plot
        axes[2].plot(df.index, df['MACD'], label='MACD')
        axes[2].plot(df.index, df['MACD_Signal'], label='Signal Line')
        axes[2].bar(df.index, df['MACD_Hist'], color='gray', alpha=0.3, label='Histogram')
        axes[2].set_title('MACD Indicator')
        axes[2].set_ylabel('MACD Value')
        axes[2].legend()
        axes[2].grid(True)
        
        plt.tight_layout()
        plt.show()
    
    def run_analysis(self):
        """Run the complete analysis pipeline"""
        print("Fetching market data...")
        self.fetch_data()
        
        print("Calculating technical indicators...")
        self.calculate_indicators()
        
        print("Generating trading signals...")
        self.generate_signals()
        
        print("Building prediction models...")
        for symbol in self.symbols:
            if symbol in self.market_data:
                self.build_prediction_model(symbol)
    
    def get_current_signals(self):
        """Get the most recent trading signals for all symbols"""
        current_signals = {}
        
        for symbol in self.symbols:
            if symbol not in self.signals:
                continue
                
            signal = self.signals[symbol].iloc[-1].to_dict()
            prediction = self.predict_price_movement(symbol)
            
            if prediction:
                signal.update(prediction)
            
            current_signals[symbol] = signal
            
        return current_signals

# Example usage
if __name__ == "__main__":
    # Initialize the Forex Trading Assistant
    assistant = ForexTradingAssistant(
        symbols=['EURUSD=X', 'USDJPY=X', 'GBPUSD=X', 'XAUUSD=X'],
        lookback_period='60d',
        interval='1h'
    )
    
    # Run the analysis pipeline
    assistant.run_analysis()
    
    # Display signals for each symbol
    for symbol in assistant.symbols:
        if symbol in assistant.signals:
            print(f"\n=== Latest Signal for {symbol} ===")
            latest_signal = assistant.signals[symbol].iloc[-1]
            print(f"Price: {latest_signal['Close']:.4f}")
            print(f"Signal Strength: {latest_signal['Combined_Signal']:.2f}")
            print(f"Strong Buy: {latest_signal['Strong_Buy']}")
            print(f"Strong Sell: {latest_signal['Strong_Sell']}")
            
            if latest_signal['Strong_Buy']:
                print(f"Suggested Stop Loss: {latest_signal['Suggested_SL_Buy']:.4f}")
                print(f"Suggested Take Profit: {latest_signal['Suggested_TP_Buy']:.4f}")
            elif latest_signal['Strong_Sell']:
                print(f"Suggested Stop Loss: {latest_signal['Suggested_SL_Sell']:.4f}")
                print(f"Suggested Take Profit: {latest_signal['Suggested_TP_Sell']:.4f}")
            
            # Make price prediction
            prediction = assistant.predict_price_movement(symbol)
            if prediction:
                print(f"\nPredicted Direction: {prediction['predicted_direction']}")
                print(f"Predicted Target: {prediction['predicted_first_target']:.4f}")
                print(f"Predicted Change: {prediction['predicted_change']:.4f} ({prediction['predicted_pct']:.2f}%)")
            
            # Visualize the signals
            assistant.visualize_signals(symbol, periods=30)



            # Forex Trading Assistant - Backtesting Module
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import yfinance as yf
from datetime import datetime, timedelta
import talib
from sklearn.preprocessing import MinMaxScaler
import seaborn as sns
from tqdm import tqdm
import pytz

class ForexBacktester:
    def __init__(self, trading_assistant, start_date=None, end_date=None):
        """
        Initialize the backtesting system
        
        Parameters:
        -----------
        trading_assistant : ForexTradingAssistant
            The trading assistant instance to backtest
        start_date : datetime
            Start date for backtesting
        end_date : datetime
            End date for backtesting
        """
        self.trading_assistant = trading_assistant
        self.start_date = start_date or (datetime.now() - timedelta(days=3*365))
        self.end_date = end_date or datetime.now()
        self.results = {}
        self.trade_history = {}
        self.performance_metrics = {}
        
    def fetch_historical_data(self, symbols=None, interval='1h'):
        """Fetch historical data for backtesting"""
        symbols = symbols or self.trading_assistant.symbols
        
        print(f"Fetching historical data from {self.start_date.strftime('%Y-%m-%d')} to {self.end_date.strftime('%Y-%m-%d')}")
        
        for symbol in symbols:
            try:
                data = yf.download(
                    symbol, 
                    start=self.start_date, 
                    end=self.end_date, 
                    interval=interval
                )
                
                if not data.empty:
                    self.trading_assistant.market_data[symbol] = data
                    print(f"Successfully loaded {len(data)} periods of historical data for {symbol}")
                else:
                    print(f"No data available for {symbol}")
            except Exception as e:
                print(f"Error fetching data for {symbol}: {e}")
    
    def run_backtest(self, initial_capital=10000.0, position_size_pct=2.0, symbols=None):
        """
        Run the backtest on historical data
        
        Parameters:
        -----------
        initial_capital : float
            Starting capital for backtest
        position_size_pct : float
            Position size as percentage of capital
        symbols : list
            List of symbols to backtest
        """
        symbols = symbols or self.trading_assistant.symbols
        
        # Calculate indicators and generate signals
        self.trading_assistant.calculate_indicators()
        self.trading_assistant.generate_signals()
        
        for symbol in symbols:
            if symbol not in self.trading_assistant.signals:
                print(f"No signals generated for {symbol}, skipping backtest")
                continue
            
            print(f"Running backtest for {symbol}...")
            
            # Initialize results tracking
            signals = self.trading_assistant.signals[symbol].copy()
            backtest_results = signals.copy()
            
            # Trading parameters
            capital = initial_capital
            position_size = capital * (position_size_pct / 100)
            in_position = False
            position_type = None
            entry_price = 0
            stop_loss = 0
            take_profit = 0
            entry_date = None
            
            trades = []
            
            # Add columns for backtest results
            backtest_results['Capital'] = initial_capital
            backtest_results['Position'] = None
            backtest_results['EntryPrice'] = np.nan
            backtest_results['StopLoss'] = np.nan
            backtest_results['TakeProfit'] = np.nan
            backtest_results['PnL'] = 0.0
            backtest_results['PnL_Pct'] = 0.0
            backtest_results['Trade_Result'] = None
            
            # Loop through the signals dataframe
            for i, (idx, row) in enumerate(tqdm(signals.iterrows(), total=len(signals))):
                current_price = row['Close']
                
                # Skip first few rows that might have NaN due to indicator calculations
                if pd.isna(row['Combined_Signal']):
                    continue
                
                # Check if we are in a position
                if in_position:
                    # Check for exit conditions (SL, TP, or opposing signal)
                    exit_signal = False
                    exit_reason = None
                    
                    if position_type == 'BUY':
                        # Stop loss hit
                        if current_price <= stop_loss:
                            exit_signal = True
                            exit_reason = 'Stop Loss'
                        # Take profit hit
                        elif current_price >= take_profit:
                            exit_signal = True
                            exit_reason = 'Take Profit'
                        # Strong sell signal
                        elif row['Strong_Sell']:
                            exit_signal = True
                            exit_reason = 'Reverse Signal'
                    
                    elif position_type == 'SELL':
                        # Stop loss hit
                        if current_price >= stop_loss:
                            exit_signal = True
                            exit_reason = 'Stop Loss'
                        # Take profit hit
                        elif current_price <= take_profit:
                            exit_signal = True
                            exit_reason = 'Take Profit'
                        # Strong buy signal
                        elif row['Strong_Buy']:
                            exit_signal = True
                            exit_reason = 'Reverse Signal'
                    
                    # Process exit if needed
                    if exit_signal:
                        if position_type == 'BUY':
                            profit = (current_price - entry_price) * (position_size / entry_price)
                            profit_pct = (current_price - entry_price) / entry_price * 100
                        else:  # SELL
                            profit = (entry_price - current_price) * (position_size / entry_price)
                            profit_pct = (entry_price - current_price) / entry_price * 100
                        
                        capital += profit
                        
                        # Record the trade
                        trade = {
                            'Symbol': symbol,
                            'Entry_Date': entry_date,
                            'Entry_Price': entry_price,
                            'Exit_Date': idx,
                            'Exit_Price': current_price,
                            'Type': position_type,
                            'PnL': profit,
                            'PnL_Pct': profit_pct,
                            'Exit_Reason': exit_reason,
                            'Position_Size': position_size,
                            'Duration': (idx - entry_date).total_seconds() / 3600  # Duration in hours
                        }
                        trades.append(trade)
                        
                        # Update results
                        backtest_results.loc[idx, 'Trade_Result'] = exit_reason
                        backtest_results.loc[idx, 'PnL'] = profit
                        backtest_results.loc[idx, 'PnL_Pct'] = profit_pct
                        
                        # Reset position
                        in_position = False
                        position_type = None
                        
                        # Update position size based on new capital
                        position_size = capital * (position_size_pct / 100)
                
                # Check for entry conditions if not in a position
                if not in_position:
                    # Buy signal
                    if row['Strong_Buy']:
                        in_position = True
                        position_type = 'BUY'
                        entry_price = current_price
                        stop_loss = row['Suggested_SL_Buy']
                        take_profit = row['Suggested_TP_Buy']
                        entry_date = idx
                        
                        # Update results
                        backtest_results.loc[idx, 'Position'] = 'BUY'
                        backtest_results.loc[idx, 'EntryPrice'] = entry_price
                        backtest_results.loc[idx, 'StopLoss'] = stop_loss
                        backtest_results.loc[idx, 'TakeProfit'] = take_profit
                    
                    # Sell signal
                    elif row['Strong_Sell']:
                        in_position = True
                        position_type = 'SELL'
                        entry_price = current_price
                        stop_loss = row['Suggested_SL_Sell']
                        take_profit = row['Suggested_TP_Sell']
                        entry_date = idx
                        
                        # Update results
                        backtest_results.loc[idx, 'Position'] = 'SELL'
                        backtest_results.loc[idx, 'EntryPrice'] = entry_price
                        backtest_results.loc[idx, 'StopLoss'] = stop_loss
                        backtest_results.loc[idx, 'TakeProfit'] = take_profit
                
                # Update capital in results
                backtest_results.loc[idx, 'Capital'] = capital
            
            # Close any open position at the end of the backtest
            if in_position:
                last_price = backtest_results['Close'].iloc[-1]
                
                if position_type == 'BUY':
                    profit = (last_price - entry_price) * (position_size / entry_price)
                    profit_pct = (last_price - entry_price) / entry_price * 100
                else:  # SELL
                    profit = (entry_price - last_price) * (position_size / entry_price)
                    profit_pct = (entry_price - last_price) / entry_price * 100
                
                capital += profit
                
                # Record the trade
                trade = {
                    'Symbol': symbol,
                    'Entry_Date': entry_date,
                    'Entry_Price': entry_price,
                    'Exit_Date': backtest_results.index[-1],
                    'Exit_Price': last_price,
                    'Type': position_type,
                    'PnL': profit,
                    'PnL_Pct': profit_pct,
                    'Exit_Reason': 'End of Backtest',
                    'Position_Size': position_size,
                    'Duration': (backtest_results.index[-1] - entry_date).total_seconds() / 3600  # Duration in hours
                }
                trades.append(trade)
            
            # Store results
            self.results[symbol] = backtest_results
            self.trade_history[symbol] = pd.DataFrame(trades)
            
            # Calculate performance metrics
            self.calculate_performance_metrics(symbol, initial_capital)
    
    def calculate_performance_metrics(self, symbol, initial_capital):
        """Calculate performance metrics for the backtest"""
        if symbol not in self.trade_history:
            return
        
        trades_df = self.trade_history[symbol]
        
        if trades_df.empty:
            print(f"No trades found for {symbol} during the backtest period")
            return
        
        # Calculate metrics
        total_trades = len(trades_df)
        winning_trades = len(trades_df[trades_df['PnL'] > 0])
        losing_trades = len(trades_df[trades_df['PnL'] <= 0])
        win_rate = winning_trades / total_trades * 100 if total_trades > 0 else 0
        
        total_profit = trades_df['PnL'].sum()
        max_profit = trades_df['PnL'].max() if not trades_df.empty else 0
        max_loss = trades_df['PnL'].min() if not trades_df.empty else 0
        
        avg_profit = trades_df[trades_df['PnL'] > 0]['PnL'].mean() if winning_trades > 0 else 0
        avg_loss = trades_df[trades_df['PnL'] <= 0]['PnL'].mean() if losing_trades > 0 else 0
        
        profit_factor = abs(trades_df[trades_df['PnL'] > 0]['PnL'].sum() / trades_df[trades_df['PnL'] < 0]['PnL'].sum()) if trades_df[trades_df['PnL'] < 0]['PnL'].sum() != 0 else float('inf')
        
        # Calculate drawdown
        capital_curve = self.results[symbol]['Capital'].copy()
        rolling_max = capital_curve.cummax()
        drawdown = (capital_curve - rolling_max) / rolling_max * 100
        max_drawdown = drawdown.min()
        
        # Calculate Sharpe ratio (using daily returns approximation)
        daily_returns = self.results[symbol]['PnL'].resample('D').sum() / initial_capital
        sharpe_ratio = np.sqrt(252) * daily_returns.mean() / daily_returns.std() if daily_returns.std() != 0 else 0
        
        # Store metrics
        self.performance_metrics[symbol] = {
            'Initial_Capital': initial_capital,
            'Final_Capital': self.results[symbol]['Capital'].iloc[-1],
            'Total_Return': (self.results[symbol]['Capital'].iloc[-1] - initial_capital) / initial_capital * 100,
            'Total_Trades': total_trades,
            'Winning_Trades': winning_trades,
            'Losing_Trades': losing_trades,
            'Win_Rate': win_rate,
            'Total_Profit': total_profit,
            'Max_Profit_Trade': max_profit,
            'Max_Loss_Trade': max_loss,
            'Average_Profit': avg_profit,
            'Average_Loss': avg_loss,
            'Profit_Factor': profit_factor,
            'Max_Drawdown': max_drawdown,
            'Sharpe_Ratio': sharpe_ratio
        }
    
    def display_performance_summary(self, symbol=None):
        """Display performance summary for one or all symbols"""
        if symbol:
            symbols = [symbol]
        else:
            symbols = list(self.performance_metrics.keys())
        
        for sym in symbols:
            if sym not in self.performance_metrics:
                print(f"No performance metrics available for {sym}")
                continue
            
            metrics = self.performance_metrics[sym]
            
            print(f"\n============= Performance Summary for {sym} =============")
            print(f"Test Period: {self.start_date.strftime('%Y-%m-%d')} to {self.end_date.strftime('%Y-%m-%d')}")
            print(f"Initial Capital: ${metrics['Initial_Capital']:.2f}")
            print(f"Final Capital: ${metrics['Final_Capital']:.2f}")
            print(f"Total Return: {metrics['Total_Return']:.2f}%")
            print(f"Total Trades: {metrics['Total_Trades']}")
            print(f"Win Rate: {metrics['Win_Rate']:.2f}%")
            print(f"Profit Factor: {metrics['Profit_Factor']:.2f}")
            print(f"Max Drawdown: {metrics['Max_Drawdown']:.2f}%")
            print(f"Sharpe Ratio: {metrics['Sharpe_Ratio']:.2f}")
            print(f"Average Profit: ${metrics['Average_Profit']:.2f}")
            print(f"Average Loss: ${metrics['Average_Loss']:.2f}")
            print(f"Max Profit Trade: ${metrics['Max_Profit_Trade']:.2f}")
            print(f"Max Loss Trade: ${metrics['Max_Loss_Trade']:.2f}")
    
    def plot_equity_curve(self, symbol):
        """Plot equity curve and drawdown for a symbol"""
        if symbol not in self.results:
            print(f"No results available for {symbol}")
            return
        
        results = self.results[symbol]
        
        # Calculate drawdown
        capital_curve = results['Capital'].copy()
        rolling_max = capital_curve.cummax()
        drawdown = (capital_curve - rolling_max) / rolling_max * 100
        
        # Create the figure and axes
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={'height_ratios': [3, 1]})
        
        # Plot equity curve
        ax1.plot(results.index, results['Capital'], label='Equity Curve')
        
        # Add buy and sell markers
        buys = results[results['Position'] == 'BUY']
        sells = results[results['Position'] == 'SELL']
        
        # Mark trade entries
        ax1.scatter(buys.index, buys['Capital'], marker='^', color='green', s=100, label='Buy Entry')
        ax1.scatter(sells.index, sells['Capital'], marker='v', color='red', s=100, label='Sell Entry')
        
        # Mark trade exits with PnL
        exits = results[results['Trade_Result'].notna()]
        for idx, row in exits.iterrows():
            color = 'green' if row['PnL'] > 0 else 'red'
            marker = 'o'
            ax1.scatter(idx, row['Capital'], marker=marker, color=color, s=80)
            ax1.annotate(f"${row['PnL']:.2f}", 
                        (idx, row['Capital']), 
                        xytext=(5, 10), 
                        textcoords='offset points',
                        fontsize=8,
                        color=color)
        
        ax1.set_title(f'{symbol} Equity Curve')
        ax1.set_ylabel('Capital ($)')
        ax1.legend()
        ax1.grid(True)
        
        # Plot drawdown
        ax2.fill_between(results.index, 0, drawdown, color='red', alpha=0.3)
        ax2.set_title('Drawdown')
        ax2.set_ylabel('Drawdown (%)')
        ax2.set_ylim(min(drawdown.min() * 1.5, -5), 5)  # Set y-axis limit with some margin
        ax2.grid(True)
        
        plt.tight_layout()
        plt.show()
    
    def plot_trade_distribution(self, symbol):
        """Plot trade distribution statistics"""
        if symbol not in self.trade_history:
            print(f"No trade history available for {symbol}")
            return
        
        trades = self.trade_history[symbol]
        
        if trades.empty:
            print(f"No trades found for {symbol}")
            return
        
        fig, axes = plt.subplots(2, 2, figsize=(14, 10))
        
        # Plot 1: Distribution of profits/losses
        sns.histplot(trades['PnL'], kde=True, ax=axes[0, 0], color='blue')
        axes[0, 0].axvline(x=0, color='r', linestyle='--')
        axes[0, 0].set_title('Distribution of Profits/Losses')
        axes[0, 0].set_xlabel('Profit/Loss ($)')
        axes[0, 0].set_ylabel('Frequency')
        
        # Plot 2: PnL by trade type
        sns.boxplot(x='Type', y='PnL', data=trades, ax=axes[0, 1])
        axes[0, 1].set_title('PnL by Trade Type')
        axes[0, 1].set_xlabel('Trade Type')
        axes[0, 1].set_ylabel('Profit/Loss ($)')
        
        # Plot 3: PnL by exit reason
        sns.boxplot(x='Exit_Reason', y='PnL', data=trades, ax=axes[1, 0])
        axes[1, 0].set_title('PnL by Exit Reason')
        axes[1, 0].set_xlabel('Exit Reason')
        axes[1, 0].set_ylabel('Profit/Loss ($)')
        plt.setp(axes[1, 0].xaxis.get_majorticklabels(), rotation=45)
        
        # Plot 4: PnL vs Duration
        sns.scatterplot(x='Duration', y='PnL', hue='Type', data=trades, ax=axes[1, 1])
        axes[1, 1].set_title('PnL vs Trade Duration')
        axes[1, 1].set_xlabel('Duration (hours)')
        axes[1, 1].set_ylabel('Profit/Loss ($)')
        
        plt.tight_layout()
        plt.show()
    
    def monthly_performance(self, symbol):
        """Calculate and display monthly performance"""
        if symbol not in self.trade_history:
            print(f"No trade history available for {symbol}")
            return None
        
        trades = self.trade_history[symbol]
        
        if trades.empty:
            print(f"No trades found for {symbol}")
            return None
        
        # Resample trades to monthly periods
        trades['Year_Month'] = trades['Exit_Date'].dt.to_period('M')
        monthly_pnl = trades.groupby('Year_Month')['PnL'].sum()
        monthly_trades = trades.groupby('Year_Month').size()
        monthly_win_rate = trades.groupby('Year_Month').apply(
            lambda x: (x['PnL'] > 0).sum() / len(x) * 100 if len(x) > 0 else 0
        )
        
        # Create monthly performance dataframe
        monthly_perf = pd.DataFrame({
            'PnL': monthly_pnl,
            'Trades': monthly_trades,
            'Win_Rate': monthly_win_rate
        })
        
        # Display monthly performance
        print(f"\n========== Monthly Performance for {symbol} ==========")
        print(monthly_perf)
        
        # Plot monthly performance
        fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 12), sharex=True)
        
        # Plot monthly P&L
        monthly_perf['PnL'].plot(kind='bar', ax=ax1, color=monthly_perf['PnL'].apply(lambda x: 'green' if x > 0 else 'red'))
        ax1.set_title(f'{symbol} Monthly P&L')
        ax1.set_ylabel('Profit/Loss ($)')
        ax1.set_xlabel('')
        ax1.grid(True, axis='y')
        
        # Plot number of trades per month
        monthly_perf['Trades'].plot(kind='bar', ax=ax2, color='blue')
        ax2.set_title('Number of Trades per Month')
        ax2.set_ylabel('Number of Trades')
        ax2.set_xlabel('')
        ax2.grid(True, axis='y')
        
        # Plot win rate per month
        monthly_perf['Win_Rate'].plot(kind='bar', ax=ax3, color='purple')
        ax3.set_title('Win Rate per Month (%)')
        ax3.set_ylabel('Win Rate (%)')
        ax3.set_xlabel('Month')
        ax3.grid(True, axis='y')
        
        plt.tight_layout()
        plt.show()
        
        return monthly_perf

    def generate_report(self, symbol, output_file=None):
        """Generate a comprehensive backtest report"""
        if symbol not in self.performance_metrics:
            print(f"No performance metrics available for {symbol}")
            return
        
        # Display performance summary
        self.display_performance_summary(symbol)
        
        # Plot equity curve
        self.plot_equity_curve(symbol)
        
        # Plot trade distribution
        self.plot_trade_distribution(symbol)
        
        # Display monthly performance
        self.monthly_performance(symbol)
        
        # TODO: If needed, save the report to a file


# Example usage
if __name__ == "__main__":
    # Define the symbols to backtest
    symbols_to_test = ['USDJPY=X', 'XAUUSD=X']  # JPY/USD and Gold/USD
    
    # Create the trading assistant
    assistant = ForexTradingAssistant(
        symbols=symbols_to_test,
        lookback_period='1095d',  # 3 years
        interval='1h'  # 1-hour timeframe
    )
    
    # Create the backtester
    backtester = ForexBacktester(
        trading_assistant=assistant,
        start_date=datetime.now() - timedelta(days=3*365),
        end_date=datetime.now()
    )
    
    # Fetch historical data
    backtester.fetch_historical_data(symbols=symbols_to_test)
    
    # Run the backtest
    backtester.run_backtest(
        initial_capital=10000.0,
        position_size_pct=2.0,
        symbols=symbols_to_test
    )
    
    # Generate reports for each symbol
    for symbol in symbols_to_test:
        print(f"\n\n==============================")
        print(f"  BACKTEST RESULTS: {symbol}")
        print(f"==============================")
        backtester.generate_report(symbol)

# Run with different parameters for optimization
if __name__ == "__main__":
    # Define the symbols to backtest
    symbols_to_test = ['USDJPY=X', 'XAUUSD=X']  # JPY/USD and Gold/USD
    
    # Parameter grid for optimization
    position_sizes = [1.0, 2.0, 3.0]
    intervals = ['1h', '4h']
    
    best_results = {}
    
    for interval in intervals:
        for position_size in position_sizes:
            print(f"\n\nTesting with interval={interval}, position_size={position_size}%")
            
            # Create the trading assistant
            assistant = ForexTradingAssistant(
                symbols=symbols_to_test,
                lookback_period='1095d',  # 3 years
                interval=interval
            )
            
            # Create the backtester
            backtester = ForexBacktester(
                trading_assistant=assistant,
                start_date=datetime.now() - timedelta(days=3*365),
                end_date=datetime.now()
            )
            
            # Fetch historical data
            backtester.fetch_historical_data(symbols=symbols_to_test, interval=interval)
            
            # Run the backtest
            backtester.run_backtest(
                initial_capital=10000.0,
                position_size_pct=position_size,
                symbols=symbols_to_test
            )
            
            # Store results for comparison
            for symbol in symbols_to_test:
                if symbol not in best_results:
                    best_results[symbol] = {
                        'params': {},
                        'metrics': None,
                        'total_return': -float('inf')
                    }
                
                if symbol in backtester.performance_metrics:
                    total_return = backtester.performance_metrics[symbol]['Total_Return']
                    
                    if total_return > best_results[symbol]['total_return']:
                        best_results[symbol] = {
                            'params': {
                                'interval': interval,
                                'position_size': position_size
                            },
                            'metrics': backtester.performance_metrics[symbol],
                            'total_return': total_return
                        }
    
    # Display best results
    print("\n\n==============================")
    print("  OPTIMIZATION RESULTS")
    print("==============================")
    
    for symbol, result in best_results.items():
        print(f"\nBest parameters for {symbol}:")
        print(f"Interval: {result['params'].get('interval')}")
        print(f"Position Size: {result['params'].get('position_size')}%")
        print(f"Total Return: {result['total_return']:.2f}%")
        
        if result['metrics']:
            print(f"Win Rate: {result['metrics']['Win_Rate']:.2f}%")
            print(f"Profit Factor: {result['metrics']['Profit_Factor']:.2f}")
            print(f"Max Drawdown: {result['metrics']['Max_Drawdown']:.2f}%")
            print(f"Sharpe Ratio: {result['metrics']['Sharpe_Ratio']:.2f}")


Yes, so I'm trying to build a platform for think-analysis, basically Check the forex markets, know exactly when to enter trades like gold, silver, CHF, USD, JPY, USD, and accurately predict when to enter these trades, like okay, it's going to probably fall in the next couple of minutes, or it's going to probably fall in the next couple of pips. This is the best entry point, and probably the TP and SL, basically like a trader assistance or a trader itself, but in AI or in code form. What I wanted to do for me is draft an entire product document for the requirements, what we take, the design concepts, and what it's, and like maybe POC, like proof of concept or something that can be done in this manner, so that I can review it and see if it's worth pursuing

Majorly the POC code is critical built in python and make it robust and comprehensive

<think>
The user is asking me to create a comprehensive product document and proof of concept (POC) code for a forex trading assistant/prediction platform. Let me break down what they're requesting:
A platform for "think-analysis" in forex markets
The ability to predict entry points for trading various currency pairs and precious metals
Predictions for price movements (up/down), entry points, take profit (TP) and stop loss (SL) levels
A complete product requirements document
A robust POC in Python
This is a complex request that involves financial prediction, which is challenging and comes with significant caveats. I need to be careful not to oversell what's possible, while still providing helpful information. I'll structure my response to include:
Product Requirements Document (PRD)
System Architecture
Key Components
Implementation Considerations
Proof of Concept (Python code)
Limitations and Risks
I'll be clear that financial prediction is inherently uncertain and that no system can guarantee profits. The POC will demonstrate a framework, but won't claim to have solved the extremely difficult problem of consistently profitable automated trading.
</think>
Forex Trading Assistant Platform: Product Document & POC
1. Executive Summary
This document outlines the requirements and implementation approach for a Forex Trading Assistant platform. The system aims to analyze market data in real-time, identify potential trading opportunities, and provide actionable recommendations for trading forex pairs and precious metals like gold and silver.
2. Product Requirements
2.1 Core Capabilities
Real-time analysis of forex market data
Pattern recognition to identify potential entry/exit points
Dynamic calculation of suggested Take Profit (TP) and Stop Loss (SL) levels
Multi-timeframe analysis (1m, 5m, 15m, 1h, 4h, daily)
Support for major currency pairs and metals (EUR/USD, USD/JPY, GBP/USD, XAU/USD, XAG/USD, etc.)
Risk management recommendations based on account size and risk tolerance
Notification system for potential trade opportunities
2.2 User Requirements
Simple web/desktop interface to view recommendations
Configuration panel for risk parameters and instruments of interest
Historical performance metrics and backtesting capabilities
Trade logging and performance tracking
Mobile notifications for trade signals
2.3 Technical Requirements
Real-time data feed integration (e.g., OANDA, MetaTrader, Alpha Vantage)
Scalable backend for processing market data
Machine learning components for pattern recognition
Secure API for user authentication and data access
Database for storing historical data and user preferences
3. System Design
3.1 Architecture Overview
└───────────────┘
3.2 Key Components
Data Acquisition Module: Connects to forex data providers and streams real-time market data
Analysis Engine: Processes market data using technical indicators and ML models
Signal Generation System: Identifies potential trade opportunities based on analysis
Risk Management Module: Calculates appropriate position sizes and SL/TP levels
User Interface: Displays signals and allows for configuration
Database: Stores historical data, signals, and user preferences
4. Technical Approach
4.1 Analysis Methodologies
Technical indicators (RSI, MACD, Moving Averages, Bollinger Bands)
Support/resistance level identification
Chart pattern recognition
Price action analysis
Volume analysis (where applicable)
Volatility measurements
Correlation analysis between currency pairs
4.2 Machine Learning Approaches
Time series forecasting using LSTM/GRU neural networks
Classification models for trend direction prediction
Reinforcement learning for optimizing entry/exit points
Anomaly detection for identifying unusual market behavior
Ensemble methods to combine multiple predictive models
5. Proof of Concept Implementation
Below is a Python POC implementing a simplified version of the trading assistant. It includes:
Data acquisition
Technical analysis
Signal generation
Basic visualization
)
6. Implementation Plan
6.1 Phase 1: Core Framework (2-3 months)
Develop data acquisition pipeline
Implement basic technical analysis
Create signal generation logic
Build simple UI for viewing signals
Implement backtesting system
6.2 Phase 2: Machine Learning Enhancement (2-3 months)
Train and integrate ML models
Develop pattern recognition capabilities
Implement adaptive risk management
Add multi-timeframe analysis
Create performance analytics dashboard
6.3 Phase 3: Platform Expansion (3-4 months)
Mobile app development
Add more sophisticated entry/exit strategies
Implement portfolio management features
Develop autotrading capabilities
Add social/community features
7. Risk Assessment
7.1 Technical Risks
Data quality and reliability issues
Latency in real-time data processing
Scalability challenges with concurrent users
Model drift and maintenance requirements
7.2 Market Risks
Unpredictable market behavior during news events
High volatility periods reducing prediction accuracy
Regulatory changes affecting market dynamics
Slippage between signal generation and execution
7.3 Business Risks
Market prediction accuracy limitations
User expectations management
Regulatory compliance requirements
Competition from established players
8. Important Considerations
No Guaranteed Profits: Financial markets are inherently unpredictable, and no system can guarantee profitable trades. The platform should be positioned as a decision support tool rather than an infallible prediction system.
Risk Management: Emphasize proper risk management practices and educate users about responsible trading.
Continuous Learning: The system should continuously learn from market data and user feedback to improve its predictions over time.
Transparency: Be transparent about how signals are generated and the limitations of the system.
Regulatory Compliance: Ensure compliance with relevant financial regulations in target markets.
Would you like me to expand on any specific aspect of this product document or the proof of concept code?
write a code to backtest this bot with the last 3 years data on jpyusd and gold usd

<think>
I'll write a backtesting extension for the Forex Trading Assistant that will allow testing the strategy against historical data for JPY/USD and Gold/USD (XAU/USD) over the past 3 years. The backtesting script will:
Download 3 years of historical data for the specified pairs
Run the trading strategy on this historical data
Track trades, profits/losses, and other performance metrics
Generate performance reports and visualizations
Let me create this code:
</think>
Forex Trading Assistant Backtesting System
Here's a comprehensive backtesting script that will evaluate the trading strategy on JPY/USD and Gold/USD (XAU/USD) using 3 years of historical data:
Running the Backtest with Different Parameters
You can modify the backtest to explore different settings:
)
Usage Notes and Recommendations
Data Quality: Yahoo Finance data may have gaps or inaccuracies for forex pairs. For production use, consider upgrading to a premium data provider like OANDA, Alpha Vantage, or a dedicated forex data service.
Timeframe Selection: The code defaults to hourly data for a good balance between signal quality and computational efficiency. For more granular analysis, try using smaller timeframes (5m, 15m), but be aware this will increase processing time.
Risk Management: The backtester implements a simplified risk management approach using a fixed percentage of capital. In real trading, you might want to implement more sophisticated position sizing based on volatility.
Performance Evaluation: The system calculates standard trading metrics (Sharpe ratio, drawdown, win rate), but you may want to add additional metrics like Sortino ratio, Calmar ratio, or custom risk-adjusted return metrics.
Optimization: The second example shows a simple grid search for optimal parameters. For more sophisticated optimization, consider implementing genetic algorithms or Bayesian optimization.
This backtesting framework provides a comprehensive evaluation of the trading strategy on your target instruments over the past 3 years and should help you assess its potential effectiveness before deploying with real capital.


┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Data          │    │ Analysis      │    │ Presentation  │
│ Acquisition   │───▶│ Engine        │───▶│ Layer         │
└───────────────┘    └───────────────┘    └───────────────┘
       ▲                     ▲                    ▲
       │                     │                    │
       ▼                     ▼                    ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│ Market Data   │    │ ML Models &   │    │ User          │
│ Providers     │    │ Signal Gen.   │    │ Interface     │
└───────────────┘    └───────────────┘    └───────────────┘

